"""Narrow HTTP adapters. Stripe is GET-only; Gmail sends only fixed internal recipients.

Secrets never appear in error strings or logs. Delivery calls are never retried.
"""
import base64
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import time
import uuid
import copy
import subprocess
from concurrent.futures import ThreadPoolExecutor
import urllib.error
import urllib.parse
import urllib.request
from email.message import EmailMessage
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

REPO = 'felipekrugel-eng/tars-overview'
SENDER = 'felipe.krugel@loyverse.com'
RECIPIENTS = [SENDER, 'caio.fiuza@loyverse.com', 'alex@loyverse.com']
AAD = b'loyverse-risk-monitor-v1'

class SafeError(Exception):
    pass

def http(url, method='GET', data=None, headers=None):
    body = None if data is None else (data if isinstance(data, bytes) else json.dumps(data).encode())
    request = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as err:
        raise SafeError('http_' + str(err.code)) from None
    except Exception:
        raise SafeError('network_or_response_error') from None

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()

def seal(value):
    token = os.environ.get('TELEGRAM_BOT_TOKEN')
    if not token:
        raise SafeError('telegram_secret_missing')
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=AAD, info=b'durable-state').derive(token.encode())
    nonce = os.urandom(12)
    raw = gzip.compress(canonical(value), mtime=0)
    return {'schema_version': 1, 'nonce': base64.b64encode(nonce).decode(),
            'ciphertext': base64.b64encode(AESGCM(key).encrypt(nonce, raw, AAD)).decode()}

def unseal(envelope):
    token = os.environ.get('TELEGRAM_BOT_TOKEN', '')
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=AAD, info=b'durable-state').derive(token.encode())
    try:
        raw = AESGCM(key).decrypt(base64.b64decode(envelope['nonce'], validate=True),
                                 base64.b64decode(envelope['ciphertext'], validate=True), AAD)
        return json.loads(gzip.decompress(raw))
    except Exception:
        raise SafeError('state_decryption_failed_do_not_reset') from None

def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def verified_transport(config):
    relay = load_module('risk-telegram/relay.py', 'risk_relay')
    state, sha = relay.read_state()
    if not state or state.get('status') != 'test_confirmed':
        raise SafeError('telegram_transport_unverified')
    public_hash = hashlib.sha256(state['public_key_pem'].encode()).hexdigest()
    if public_hash != config['telegram_public_key_sha256']:
        raise SafeError('telegram_pin_mismatch')
    private = relay.open_state(state['private_state'])
    me = relay.telegram('getMe')
    if not me.get('is_bot') or me.get('username', '').lower() != 'lprisk_bot' or me['id'] != private['bot_id']:
        raise SafeError('telegram_identity_mismatch')
    relay.verify_group(private['chat_id'], private['bot_id'])
    return relay, state, private, sha

class GitStore:
    """Atomic encrypted state + immutable audit record + public health timestamp.

    A checkpoint is durable only after a non-force ref update. Other master
    writers cannot be overwritten. A changed state blob causes a hard CAS failure.
    """
    def __init__(self, path='risk-monitor/state.enc.json'):
        self.path = path
        self.code_sha = os.environ.get('GITHUB_SHA')
        if os.environ.get('GITHUB_ACTIONS') == 'true':
            # workflow_run and reruns may check out a newer master than the
            # triggering event. Audit the code that is actually being executed.
            try:
                revision = subprocess.run(['git', 'rev-parse', 'HEAD'], check=True,
                                          capture_output=True, text=True, timeout=5).stdout.strip()
            except Exception:
                raise SafeError('checked_out_revision_unverified') from None
            if len(revision) != 40 or any(c not in '0123456789abcdef' for c in revision):
                raise SafeError('checked_out_revision_unverified')
            self.code_sha = revision
        self.sha = None
        self.run_id = os.environ.get('GITHUB_RUN_ID', str(int(time.time())))+'-'+os.environ.get('GITHUB_RUN_ATTEMPT','1')+'-'+uuid.uuid4().hex[:8]
        self.sequence = 0
        self.manifest = None
        self.previous = None
    def api(self, path, method='GET', data=None):
        try:
            return http('https://api.github.com/repos/' + REPO + '/' + path, method, data,
                        {'Authorization': 'Bearer ' + os.environ['GITHUB_TOKEN'],
                         'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json'})
        except SafeError as exc:
            if str(exc)=='http_404':raise
            category='_'.join(path.split('/')[:2]) if path.startswith('git/') else path.split('/')[0]
            raise SafeError('github_'+category+'_'+str(exc)) from None
    def file(self, path):
        try:
            entry = self.api('contents/' + path + '?ref=master')
        except SafeError as exc:
            if str(exc) == 'http_404':
                return None, None
            raise
        if entry.get('encoding') != 'base64':
            blob = self.api('git/blobs/' + entry['sha'])
            content = base64.b64decode(blob['content'])
        else:
            content = base64.b64decode(entry['content'])
        return content, entry['sha']
    def load(self):
        raw, self.sha = self.file(self.path)
        if not raw:
            return None
        value=unseal(json.loads(raw))
        if value.get('format')!='journal-v1':
            self.previous=copy.deepcopy(value)
            return value
        self.manifest=value
        refs=[value['snapshot']]+value['journals']
        def read_verified(ref):
            data,_=self.file(ref['path'])
            if data is None:raise SafeError('durable_journal_missing_do_not_reset')
            obj=unseal(json.loads(data))
            if hashlib.sha256(canonical(obj)).hexdigest()!=ref['sha256']:
                raise SafeError('durable_journal_checksum_mismatch')
            return obj
        with ThreadPoolExecutor(max_workers=8) as pool:
            objects=list(pool.map(read_verified,refs))
        state=objects[0]
        for journal in objects[1:]:
            if journal['audit']['previous_hash']!=state.get('audit_head'):
                raise SafeError('audit_chain_mismatch')
            audit=dict(journal['audit']);digest=audit.pop('hash')
            if hashlib.sha256(canonical(audit)).hexdigest()!=digest:
                raise SafeError('audit_record_checksum_mismatch')
            for path,value in journal['patch']['set']:
                target=state
                for key in path[:-1]:target=target.setdefault(key,{})
                target[path[-1]]=value
            for path in journal['patch']['delete']:
                target=state
                for key in path[:-1]:target=target[key]
                target.pop(path[-1],None)
            if state.get('audit_head')!=digest:
                raise SafeError('audit_state_head_mismatch')
        self.previous=copy.deepcopy(state)
        return state
    def diff(self,old,new):
        patch={'set':[],'delete':[]}
        def visit(a,b,path):
            if isinstance(a,dict) and isinstance(b,dict):
                for key in a.keys()-b.keys():patch['delete'].append(path+[key])
                for key,value in b.items():
                    if key not in a:patch['set'].append((path+[key],value))
                    else:visit(a[key],value,path+[key])
            elif a!=b:
                patch['set'].append((path,b))
        visit(old,new,[])
        return patch
    def checkpoint(self, state, event, health=None):
        self.sequence += 1
        record = {'run_id': self.run_id, 'sequence': self.sequence, 'at': int(time.time()),
                  'actor': os.environ.get('GITHUB_ACTOR', 'local'), 'code_sha':self.code_sha, 'event': event,
                  'previous_hash': state.get('audit_head')}
        record['hash'] = hashlib.sha256(canonical(record)).hexdigest()
        # Stage the head until the atomic Git ref update succeeds. A failed write
        # must not make the next checkpoint reference an uncommitted audit entry.
        staged_state = dict(state, audit_head=record['hash'])
        audit_path=f'risk-monitor/audit/{self.run_id}-{self.sequence:05d}.enc.json'
        files={}
        if self.manifest is None or len(self.manifest['journals'])>=64:
            snapshot=f'risk-monitor/snapshots/{self.run_id}-{self.sequence:05d}.enc.json'
            files[snapshot]=canonical(seal(staged_state)).decode()
            manifest={'format':'journal-v1','snapshot':{'path':snapshot,'sha256':hashlib.sha256(canonical(staged_state)).hexdigest()},'journals':[]}
            files[audit_path]=canonical(seal({'audit':record,'snapshot':snapshot})).decode()
        else:
            manifest=copy.deepcopy(self.manifest)
            journal={'audit':record,'patch':self.diff(self.previous,staged_state)}
            files[audit_path]=canonical(seal(journal)).decode()
            manifest['journals'].append({'path':audit_path,'sha256':hashlib.sha256(canonical(journal)).hexdigest()})
        files[self.path]=canonical(seal(manifest)).decode()
        if health is not None:
            files['risk-monitor/health.json'] = canonical(health).decode()
        entries=[]
        for path,content in files.items():
            entry={'path':path,'mode':'100644','type':'blob'}
            if len(content.encode())>500000:
                blob=self.api('git/blobs','POST',{'content':base64.b64encode(content.encode()).decode(),'encoding':'base64'})
                entry['sha']=blob['sha']
            else:entry['content']=content
            entries.append(entry)
        # Retry only ref conflict from unrelated writers, never delivery. Check the
        # state blob again before rebuilding on a newer parent.
        for conflict in range(8):
            ref = self.api('git/ref/heads/master')
            parent = ref['object']['sha']
            commit = self.api('git/commits/' + parent)
            _, current_sha = self.file(self.path)
            if current_sha != self.sha:
                raise SafeError('state_compare_and_swap_conflict')
            tree = self.api('git/trees', 'POST', {'base_tree': commit['tree']['sha'], 'tree':entries})
            new = self.api('git/commits', 'POST', {'message': 'chore(risk): durable checkpoint ' + self.run_id,
                                                 'tree': tree['sha'], 'parents': [parent]})
            try:
                self.api('git/refs/heads/master', 'PATCH', {'sha': new['sha'], 'force': False})
            except SafeError as exc:
                if str(exc) in ('http_422','github_git_refs_http_422') and conflict < 7:
                    time.sleep(min(0.1 * 2**conflict, 1.0))
                    continue
                raise
            raw = files[self.path].encode()
            self.sha = hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
            self.manifest=manifest
            state['audit_head']=record['hash']
            self.previous=copy.deepcopy(state)
            return new['sha']
        raise SafeError('checkpoint_ref_conflict')

class Stripe:
    def __init__(self):
        self.key = os.environ.get('STRIPE_RISK_READ_KEY')
        if not self.key:
            raise SafeError('stripe_read_key_missing')
    def get(self, path, params=None, account=None):
        # Only these immutable/read endpoints are available to this client.
        if not (path == 'account' or path in ('accounts', 'application_fees', 'refunds', 'charges')
                or path.startswith('accounts/') or path.startswith('charges/')):
            raise SafeError('stripe_endpoint_not_allowed')
        query = urllib.parse.urlencode(params or {}, doseq=True)
        headers = {'Authorization': 'Bearer ' + self.key}
        if account:
            headers['Stripe-Account'] = account
        return http('https://api.stripe.com/v1/' + path + ('?' + query if query else ''), headers=headers)
    def preflight(self):
        account = self.get('account')
        if account.get('id') != 'acct_1SSKsA7e4AMQfKY3':
            raise SafeError('stripe_platform_mismatch')
    def page(self, path, params, cursor=None):
        params = dict(params)
        if cursor:
            params['starting_after'] = cursor
        result = self.get(path, params)
        if not isinstance(result.get('data'), list) or 'has_more' not in result:
            raise SafeError('stripe_page_unknown')
        if result['has_more'] and not result['data']:
            raise SafeError('stripe_empty_page_with_more')
        return result

class Gmail:
    def __init__(self):
        raw = os.environ.get('GMAIL_RISK_OAUTH_JSON')
        if not raw:
            raise SafeError('gmail_oauth_missing')
        config = json.loads(raw)
        data = urllib.parse.urlencode({k: config[k] for k in ('client_id', 'client_secret', 'refresh_token')}
                                     | {'grant_type': 'refresh_token'}).encode()
        token = http('https://oauth2.googleapis.com/token', 'POST', data,
                     {'Content-Type': 'application/x-www-form-urlencoded'})
        self.token = token['access_token']
        if self.api('profile').get('emailAddress', '').lower() != SENDER:
            raise SafeError('gmail_sender_mismatch')
    def api(self, path, data=None):
        return http('https://gmail.googleapis.com/gmail/v1/users/me/' + path,
                    'POST' if data is not None else 'GET', data,
                    {'Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/json'})
    def search(self, query):
        items = []
        cursor = None
        while True:
            params = {'q': query, 'maxResults': 100}
            if cursor:
                params['pageToken'] = cursor
            result = self.api('messages?' + urllib.parse.urlencode(params))
            items.extend(result.get('messages', []))
            cursor = result.get('nextPageToken')
            if not cursor:
                return items
    def reconcile(self, marker):
        sent = self.search('in:sent "' + marker + '"')
        drafts = self.search('in:drafts "' + marker + '"')
        return sent, drafts
    def send_internal(self, subject, text):
        if not subject.startswith('[Loyverse Payments]'):
            raise SafeError('email_subject_invalid')
        message = EmailMessage()
        message['From'] = SENDER
        message['To'] = ', '.join(RECIPIENTS)
        message['Subject'] = subject
        message.set_content(text)
        # Fixed envelope: this adapter cannot send to merchants or add CC/BCC.
        raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
        return self.api('messages/send', {'raw': raw})
