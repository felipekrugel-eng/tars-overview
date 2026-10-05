"""Verify encrypted state and report only integrity metadata, never account data."""
import hashlib
import json
from adapters import GitStore, SafeError, canonical, unseal


def inspect(path):
    store = GitStore(path)
    raw, sha = store.file(path)
    store.sha = sha
    if not raw:
        raise SafeError('state_missing')
    manifest = unseal(json.loads(raw))
    if manifest.get('format') != 'journal-v1':
        raise SafeError('unexpected_state_format')
    refs = [manifest['snapshot']] + manifest['journals']
    state = None
    gaps = []
    for index, ref in enumerate(refs):
        data, _ = store.file(ref['path'])
        if data is None:
            raise SafeError('journal_missing')
        obj = unseal(json.loads(data))
        if hashlib.sha256(canonical(obj)).hexdigest() != ref['sha256']:
            raise SafeError('journal_checksum_mismatch')
        if index == 0:
            state = obj
            continue
        audit = dict(obj['audit'])
        digest = audit.pop('hash')
        if hashlib.sha256(canonical(audit)).hexdigest() != digest:
            raise SafeError('audit_checksum_mismatch')
        if audit['previous_hash'] != state.get('audit_head'):
            gaps.append({'path': ref['path'], 'expected': state.get('audit_head'),
                         'actual': audit['previous_hash'], 'run_id': audit['run_id'],
                         'sequence': audit['sequence'], 'event_type': audit['event']['type']})
        for keys, value in obj['patch']['set']:
            target = state
            for key in keys[:-1]:
                target = target.setdefault(key, {})
            target[keys[-1]] = value
        for keys in obj['patch']['delete']:
            target = state
            for key in keys[:-1]:
                target = target[key]
            target.pop(keys[-1], None)
        if state.get('audit_head') != digest:
            raise SafeError('audit_patch_head_mismatch')
    summary = {key: len(state.get(key, {})) for key in
               ('seen_attempts', 'attempts', 'charges', 'events', 'alerts', 'refunds', 'disputes')}
    summary['global_accounts'] = len(state.get('global', {}).get('records', {}))
    summary['processor_checked'] = sum(p.get('checked', 0) for p in state.get('full', {}).get('partitions', []))
    metadata = {'path': path, 'manifest_blob_sha': sha,
                      'journal_count': len(manifest['journals']), 'chain_gaps': gaps,
                      'reconstructed_sha256': hashlib.sha256(canonical(state)).hexdigest(),
                      'counts': summary}
    deliveries = list(state.get('alerts', {}).values()) + list(state.get('notices', {}).values())
    status_counts = {}
    for channel in ('email', 'telegram'):
        counts = {}
        for delivery in deliveries:
            status = delivery.get(channel, {}).get('status', 'missing')
            if status not in ('sent', 'send_intent', 'uncertain', 'enqueued', 'missing'):
                status = 'other'
            counts[status] = counts.get(status, 0) + 1
        status_counts[channel] = counts
    metadata['delivery_status_counts'] = status_counts
    print(json.dumps(metadata, sort_keys=True), flush=True)
    return store, state, metadata


if __name__ == '__main__':
    for path in ('risk-monitor/state.enc.json', 'risk-monitor/watchdog.enc.json'):
        inspect(path)
