"""Local producer: plaintext stays local; only returned encrypted JSON is committed."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

AAD = b"loyverse-risk-telegram-v1"


def encrypt(alert, public_key_pem):
    key = AESGCM.generate_key(bit_length=256)
    nonce = os.urandom(12)
    public = serialization.load_pem_public_key(public_key_pem.encode())
    wrapped = public.encrypt(key, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),
                                             algorithm=hashes.SHA256(), label=AAD))
    return {"schema_version": 1, "wrapped_key": base64.b64encode(wrapped).decode(),
            "nonce": base64.b64encode(nonce).decode(),
            "ciphertext": base64.b64encode(AESGCM(key).encrypt(nonce, json.dumps(alert).encode(), AAD)).decode()}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--state", required=True)
    parser.add_argument("--alert", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    state = json.loads(Path(args.state).read_text())
    alert = json.loads(Path(args.alert).read_text())
    if state.get("status") != "test_confirmed":
        raise SystemExit("Telegram test is not confirmed; do not enqueue alerts")
    digest = hashlib.sha256(alert["alert_id"].encode()).hexdigest()
    dest = Path(args.output_dir) / (digest + ".json")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(encrypt(alert, state["public_key_pem"]), indent=2))
    print(str(dest))
