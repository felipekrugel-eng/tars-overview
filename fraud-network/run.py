#!/usr/bin/env python3
"""Build the cross-account linkage graph and report on it.

    python3 fraud-network/run.py build  [--charges PATH] [--state PATH]
    python3 fraud-network/run.py report [--out PATH]

Read-only with respect to merchant accounts: this never restricts, pauses or
contacts anyone. It writes evidence and raises alerts for a human to action.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fraud_network import (addresses as addresses_mod, cards, clusters as clusters_mod,
                           documents as documents_mod, identity, report as report_mod)
from fraud_network.model import CLUSTERING_TIERS
from fraud_network.sources import (load_address_observations, load_charges,
                                   load_document_manifest)

REPO = Path(__file__).resolve().parent.parent
DEFAULT_CHARGES = REPO / "payments-automation" / "data" / "transactions.csv"
DEFAULT_ACCOUNTS = REPO / "activated-payments" / "activation-data.js"
DEFAULT_REPS = REPO / "fraud-health" / "private" / "representatives.json"
PRIVATE = Path(__file__).resolve().parent / "private"
DEFAULT_STATE = PRIVATE / "graph-state.json"
DEFAULT_ADDRESSES = PRIVATE / "addresses.json"
DEFAULT_DOCUMENTS = PRIVATE / "documents.json"


def build(charges_path, state_path, accounts_path=None, reps_path=None,
          addresses_path=None, documents_path=None, now=None):
    """Assemble the whole graph: what accounts charged, and who they claim to be.

    The two halves answer different questions. Card evidence proves that one
    operator is moving money between accounts, but only after money has moved.
    Identity evidence is visible the day an account is created and is the only
    thing that can flag an account which has never taken a payment.
    """
    now = now or int(time.time())
    observations, names = load_charges(charges_path)
    edges = (cards.card_overlap_edges(observations, names)
             + cards.relay_edges(observations, names)
             + cards.retry_edges(observations, names)
             + cards.reader_edges(observations, names))

    accounts = {}
    if accounts_path and Path(accounts_path).exists():
        accounts = identity.load_accounts(accounts_path)
        reps = identity.load_representatives(reps_path) if reps_path else {}
        edges += identity.identity_edges(accounts, reps, names)
        for acct, row in accounts.items():
            names.setdefault(acct, row.get("name") or acct)

    # IP evidence. Weak by nature and handled carefully: see addresses.py for
    # why a fixed line and a mobile pool are not the same observation.
    notes = []
    observed_addresses = load_address_observations(addresses_path) if addresses_path else []
    if observed_addresses:
        edges += addresses_mod.address_edges(observed_addresses, names)
        notes += addresses_mod.range_notes(observed_addresses, names)

    # Merchant-submitted documents, when a reviewer has pulled them locally.
    document_flags = {}
    if documents_path:
        docs = [documents_mod.inspect(path, account)
                for account, path in load_document_manifest(documents_path)]
        if docs:
            edges += documents_mod.document_edges(docs, names)
            per_account = {}
            for doc in docs:
                per_account.setdefault(doc.account, []).append(doc)
            for account, group in per_account.items():
                found = [f for doc in group for f in documents_mod.flags(doc)]
                found += documents_mod.set_flags(group)
                if found:
                    document_flags[account] = found

    previous = json.loads(state_path.read_text()) if Path(state_path).exists() else {}
    found = clusters_mod.build(edges, previous, now)
    return observations, names, accounts, edges, found, previous, notes, document_flags


def leads(edges, found):
    """Suspected-tier pairs that touch no investigation.

    These are deliberately kept out of the clusters. A pair of accounts opened
    half an hour apart in the same trade is worth one person's glance, not an
    investigation id and an alert — most of them are a shop owner opening a
    second till.
    """
    clustered = {m for c in found for m in c.members} | {p for c in found for p in c.peripheral}
    out = [e for e in edges
           if e.tier not in CLUSTERING_TIERS and e.a not in clustered and e.b not in clustered]
    return sorted(out, key=lambda e: (e.kind, e.a, e.b))


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("--charges", default=str(DEFAULT_CHARGES))
    b.add_argument("--accounts", default=str(DEFAULT_ACCOUNTS))
    b.add_argument("--representatives", default=str(DEFAULT_REPS))
    b.add_argument("--addresses", default=str(DEFAULT_ADDRESSES))
    b.add_argument("--documents", default=str(DEFAULT_DOCUMENTS))
    b.add_argument("--state", default=str(DEFAULT_STATE))
    b.add_argument("--write-state", action="store_true")
    b.add_argument("--report", help="write the investigation report to this path")
    b.add_argument("--alerts", help="write new-connection alerts to this JSON path")
    args = parser.parse_args(argv)

    observations, names, accounts, edges, found, previous, notes, document_flags = build(
        Path(args.charges), Path(args.state), Path(args.accounts), Path(args.representatives),
        Path(args.addresses), Path(args.documents))
    now = int(time.time())
    previous_ids = set(previous.get("clusters", {}))
    previous_edges = set(previous.get("edge_keys", []))
    print(f"observations: {len(observations):,}  transacting accounts: "
          f"{len({o.account for o in observations})}  profiled accounts: {len(accounts)}  "
          f"edges: {len(edges)}")
    for c in sorted(found, key=lambda x: -len(x.members)):
        print(f"\n{c.id}  [{c.strength()}]  {len(c.members)} members"
              f"{', +' + str(len(c.peripheral)) + ' peripheral' if c.peripheral else ''}")
        for m in c.members:
            print(f"    - {names.get(m, m)}  ({m})")
        for e in sorted(c.edges, key=lambda x: x.kind):
            print(f"    [{e.tier}] {e.statement}")
        profile = identity.onboarding_profile(accounts, c.members) if accounts else None
        if profile:
            print(f"    onboarding: opened over {profile['span_days']} days"
                  f"{' (burst)' if profile['burst'] else ''}"
                  + (f"; still enabled: {len(profile['still_enabled'])}"
                     if profile["still_enabled"] else ""))

    open_leads = leads(edges, found)
    if open_leads:
        print(f"\nleads ({len(open_leads)}) - suspected pairs, no investigation opened")
        for e in open_leads:
            print(f"    [{e.tier}] {e.statement}")
    for account, found_flags in sorted(document_flags.items()):
        print(f"\ndocuments - {names.get(account, account)}")
        for tier, message in found_flags:
            print(f"    [{tier}] {message}")

    if notes:
        print(f"\nnotes ({len(notes)}) - context only, never a connection")
        for tier, message in notes:
            print(f"    [{tier}] {message}")

    new_alerts = report_mod.alerts(found, names, previous_ids, previous_edges)
    if new_alerts:
        print(f"\nalerts ({len(new_alerts)})")
        for a in new_alerts:
            print(f"    {a['kind']}: {a['summary']}")

    if args.report:
        text = report_mod.render(found, names, accounts, open_leads, now, previous_ids)
        out = Path(args.report)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text)
        print(f"\nreport written to {out} ({len(text):,} bytes)")

    if args.alerts:
        out = Path(args.alerts)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(new_alerts, indent=1) + "\n")

    if args.write_state:
        state = clusters_mod.to_state(found)
        state["edge_keys"] = sorted({e.key for e in edges})
        state["generated_at"] = now
        Path(args.state).parent.mkdir(parents=True, exist_ok=True)
        Path(args.state).write_text(json.dumps(state, indent=1) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
