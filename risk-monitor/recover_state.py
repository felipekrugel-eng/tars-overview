"""One-time, pinned recovery of a reproduced pre-commit audit-head bug.

All ciphertext checksums and audit record hashes must validate. Only the exact
diagnosed metadata discontinuity is allowed, and the full reconstructed state
must match the diagnostic digest. No history or delivery receipts are reset.
"""
import hashlib
from adapters import SafeError, canonical
from diagnose_state import inspect

SOURCE_SHA = '5a2597961633a678020a48e0fd8abecc759de7b1'
STATE_DIGEST = 'c0d3461d0a27ade89c2d787eda9e3668b8446abb15e3fd83cc9f8bd8fe0a7c99'
EXPECTED_GAP = {
    'actual': '123e860ceb6b1292bf7d27c8bd9fb907b1c8e0cca38c74c8fab2282fdb4e503f',
    'event_type': 'gmail_scan_complete',
    'expected': '4d87c4084ec926b0238bf69b47f80d5a6a68bcd2c4b6b8de9505ebd20653ef76',
    'path': 'risk-monitor/audit/37310797206-1-8d1624de-00013.enc.json',
    'run_id': '37310797206-1-8d1624de',
    'sequence': 13,
}


def main():
    store, state, metadata = inspect('risk-monitor/state.enc.json')
    if metadata['manifest_blob_sha'] != SOURCE_SHA:
        # Reruns are read-only once strict replay succeeds; no second recovery.
        store.load()
        print('Strict replay already succeeds; recovery not repeated.')
        return
    if metadata['chain_gaps'] != [EXPECTED_GAP] or metadata['reconstructed_sha256'] != STATE_DIGEST:
        raise SafeError('recovery_source_not_exactly_diagnosed')
    business_state = dict(state)
    business_state.pop('audit_head', None)
    before = hashlib.sha256(canonical(business_state)).hexdigest()
    # A new authenticated snapshot anchors future strict replay while retaining
    # all immutable old records and recording the diagnosed gap in a new audit.
    store.checkpoint(state, {'type': 'verified_audit_head_recovery',
                             'source_manifest_blob_sha': SOURCE_SHA,
                             'source_state_sha256': STATE_DIGEST,
                             'diagnosed_gap': EXPECTED_GAP,
                             'reason': 'failed_checkpoint_advanced_uncommitted_head'})
    recovered = store.load()
    recovered.pop('audit_head', None)
    if hashlib.sha256(canonical(recovered)).hexdigest() != before:
        raise SafeError('recovery_changed_business_or_delivery_state')
    print('Strict replay verified. All business state and delivery records preserved.')


if __name__ == '__main__':
    main()
