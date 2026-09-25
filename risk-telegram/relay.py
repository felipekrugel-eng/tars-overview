"""Encrypted internal-alert relay; never prints tokens, chats or alert bodies."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.request

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

REPO = "felipekrugel-eng/tars-overview"
BRANCH = "master"
STATE_PATH = "risk-telegram/state.json"
AAD = b"loyverse-risk-telegram-v1"
BOT_USERNAME = "lprisk_bot"
GROUP_TITLE = "Loyverse Payments Risk"


class SafeError(Exception):
    pass


def b64(value):
    return base64.b64encode(value).decode()


def unb64(value):
    return base64.b64decode(value, validate=True)


def http(url, data=None, headers=None, method=None, missing_ok=False):
    request = urllib.request.Request(url, data=None if data is None else json.dumps(data).encode(),
                                     headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if missing_ok and error.code == 404:
            return None
        # Never include URL, request, response or exception text: bot tokens are in URLs.
        raise SafeError("http_" + str(error.code)) from None
    except Exception:
        raise SafeError("network_or_response_error") from None


def telegram(method, **data):
    result = http("https://api.telegram.org/bot" + os.environ["TELEGRAM_BOT_TOKEN"] + "/" + method,
                  data, {"Content-Type": "application/json"})
    if not result.get("ok"):
        raise SafeError("telegram_rejected")
    return result["result"]


def github(path, data=None, missing_ok=False):
    return http("https://api.github.com/repos/" + REPO + "/" + path, data,
                {"Authorization": "Bearer " + os.environ["GITHUB_TOKEN"],
                 "Accept": "application/vnd.github+json", "Content-Type": "application/json"},
                "GET" if data is None else "PUT", missing_ok)


def read_state():
    file = github("contents/" + STATE_PATH + "?ref=" + BRANCH, missing_ok=True)
    if file is None:
        return None, None
    return json.loads(base64.b64decode(file["content"])), file["sha"]


def save_state(state, sha):
    state["updated_at_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    data = {"message": "chore(risk): checkpoint Telegram delivery", "branch": BRANCH,
            "content": b64(json.dumps(state, indent=2).encode())}
    if sha:
        data["sha"] = sha
    result = github("contents/" + STATE_PATH, data)
    return result["content"]["sha"]


def state_key(token):
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=AAD, info=b"private-state").derive(token.encode())


def seal_state(private):
    nonce = os.urandom(12)
    cipher = AESGCM(state_key(os.environ["TELEGRAM_BOT_TOKEN"]))
    return {"nonce": b64(nonce), "ciphertext": b64(cipher.encrypt(nonce, json.dumps(private).encode(), AAD))}


def open_state(envelope):
    cipher = AESGCM(state_key(os.environ["TELEGRAM_BOT_TOKEN"]))
    try:
        return json.loads(cipher.decrypt(unb64(envelope["nonce"]), unb64(envelope["ciphertext"]), AAD))
    except Exception:
        raise SafeError("state_decryption_failed_do_not_reset") from None


def select_group(updates):
    candidates = {}
    diagnostics = {"updates": len(updates), "group_messages": 0, "title_matches": 0, "command_matches": 0}
    for update in updates:
        message = update.get("message", {})
        chat = message.get("chat", {})
        if chat.get("type") in ("group", "supergroup"):
            diagnostics["group_messages"] += 1
            diagnostics["title_matches"] += int(chat.get("title") == GROUP_TITLE)
            diagnostics["command_matches"] += int(message.get("text", "").strip() == "/start@" + BOT_USERNAME)
        if (chat.get("type") in ("group", "supergroup") and not chat.get("username")
                and chat.get("title") == GROUP_TITLE
                and message.get("text", "").strip() == "/start@" + BOT_USERNAME
                and not message.get("from", {}).get("is_bot", True)
                and time.time() - message.get("date", 0) < 86400):
            candidates[chat["id"]] = chat
    if len(candidates) != 1:
        print("Setup check counts: " + json.dumps(diagnostics, sort_keys=True))
        raise SafeError("one_private_group_start_command_required")
    return next(iter(candidates))


def verify_group(chat_id, bot_id):
    chat = telegram("getChat", chat_id=chat_id)
    if chat.get("type") not in ("group", "supergroup") or chat.get("username") or chat.get("title") != GROUP_TITLE:
        raise SafeError("destination_changed_hold")
    if telegram("getChatMemberCount", chat_id=chat_id) != 3:
        raise SafeError("group_must_contain_two_people_and_bot")
    member = telegram("getChatMember", chat_id=chat_id, user_id=bot_id)
    if member.get("status") not in ("member", "administrator", "creator"):
        raise SafeError("bot_cannot_post")


def decrypt_alert(envelope, private):
    key = serialization.load_pem_private_key(private["private_key_pem"].encode(), password=None)
    symmetric = key.decrypt(unb64(envelope["wrapped_key"]),
                            padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=AAD))
    return json.loads(AESGCM(symmetric).decrypt(unb64(envelope["nonce"]), unb64(envelope["ciphertext"]), AAD))


def validate_alert(alert, file_id):
    if set(alert) != {"alert_id", "text", "expires_at_epoch"}:
        raise SafeError("invalid_alert_fields")
    if not alert["alert_id"].startswith("loyverse_payments_risk_v1:"):
        raise SafeError("invalid_campaign")
    digest = hashlib.sha256(alert["alert_id"].encode()).hexdigest()
    if digest != file_id or not isinstance(alert["text"], str) or not 1 <= len(alert["text"]) <= 3500:
        raise SafeError("invalid_alert_payload")
    if not isinstance(alert["expires_at_epoch"], (int, float)) or alert["expires_at_epoch"] < time.time():
        raise SafeError("expired_alert_hold")
    return digest


def deliver(state, private, sha, digest, text):
    # A persisted intent means possibly sent. Never automatically retry it.
    if digest in state["receipts"]:
        return sha
    state["receipts"][digest] = {"status": "send_intent", "prepared_epoch": int(time.time())}
    sha = save_state(state, sha)
    try:
        result = telegram("sendMessage", chat_id=private["chat_id"], text=text,
                          protect_content=True, link_preview_options={"is_disabled": True})
        if result.get("chat", {}).get("id") != private["chat_id"] or not result.get("message_id"):
            raise SafeError("unconfirmed_delivery")
        state["receipts"][digest].update(status="sent", message_id=result["message_id"],
                                         sent_epoch=int(time.time()))
        return save_state(state, sha)
    except Exception:
        # Persistent send_intent survives a crash, timeout or checkpoint conflict.
        raise SafeError("delivery_uncertain_manual_reconciliation_required") from None


def main():
    if os.environ.get("GITHUB_REPOSITORY") != REPO or not os.environ.get("TELEGRAM_BOT_TOKEN"):
        raise SafeError("repository_or_secret_missing")
    if os.environ.get("GITHUB_REF") != "refs/heads/" + BRANCH:
        raise SafeError("default_branch_only")
    state, sha = read_state()
    me = telegram("getMe")
    if me.get("username", "").lower() != BOT_USERNAME or not me.get("is_bot"):
        raise SafeError("bot_identity_mismatch")
    if state is None:
        if telegram("getWebhookInfo").get("url"):
            raise SafeError("existing_webhook_do_not_modify")
        chat_id = select_group(telegram("getUpdates", limit=100, timeout=0))
        verify_group(chat_id, me["id"])
        key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
        private = {"chat_id": chat_id, "bot_id": me["id"], "private_key_pem": key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()}
        state = {"schema_version": 1, "bot_username": BOT_USERNAME, "status": "configured",
                 "public_key_pem": key.public_key().public_bytes(serialization.Encoding.PEM,
                    serialization.PublicFormat.SubjectPublicKeyInfo).decode(),
                 "private_state": seal_state(private), "receipts": {}}
        sha = save_state(state, sha)
    else:
        private = open_state(state["private_state"])
        if private["bot_id"] != me["id"]:
            raise SafeError("bot_identity_changed")
        verify_group(private["chat_id"], me["id"])
    test_id = hashlib.sha256(b"loyverse_payments_risk_v1:telegram:setup-test:v1").hexdigest()
    sha = deliver(state, private, sha, test_id,
                  "Loyverse Payment Risk — connection test\n\nTelegram delivery is working. "
                  "Risk alerts will be enabled after this test is verified. Internal alerts also go by email "
                  "to Felipe and Caio. Merchant emails remain unsent drafts. No payout or account action is taken.")
    if state["receipts"][test_id]["status"] != "sent":
        raise SafeError("test_delivery_uncertain_hold")
    state["status"] = "test_confirmed"
    sha = save_state(state, sha)
    for file in sorted(Path("risk-telegram/outbox").glob("*.json")):
        if not re.fullmatch(r"[0-9a-f]{64}", file.stem):
            raise SafeError("invalid_outbox_filename")
        if file.stem in state["receipts"]:
            continue
        alert = decrypt_alert(json.loads(file.read_text()), private)
        try:
            digest = validate_alert(alert, file.stem)
        except SafeError as error:
            if str(error) != "invalid_campaign":
                raise
            state["receipts"][file.stem] = {
                "status": "rejected_invalid_campaign",
                "rejected_epoch": int(time.time()),
            }
            sha = save_state(state, sha)
            continue
        sha = deliver(state, private, sha, digest, alert["text"])
    print("Telegram relay completed; see encrypted state and delivery receipts.")


if __name__ == "__main__":
    try:
        main()
    except SafeError as error:
        print("Relay stopped: " + str(error))
        sys.exit(1)
    except Exception:
        print("Relay stopped: validation or runtime failure; no automatic retry of send intents.")
        sys.exit(1)
