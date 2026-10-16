"""What an IP address is worth as evidence.

The Think Big investigation turned on one distinction. Four accounts accepted
terms and ran payments from 74.105.171.233, a Verizon fixed-line consumer
allocation — one subscriber line at one premises, over sixteen days. Several
others touched 172.59.x addresses, which are T-Mobile mobile pools where the
carrier reassigns addresses constantly and a match means two people were on
the same network in the same region, nothing more.

Treating those two observations the same way would be the single easiest way
to turn this system into one that accuses innocent merchants. So:

  * An exact repeat on a fixed-line address is strong evidence.
  * An exact repeat on a mobile address is a lead.
  * A shared range on a mobile address is not evidence at all and never
    becomes an edge.

The classification below is a heuristic from published allocations, not a
live registry lookup, because a detector that needs the network to decide
whether to accuse someone is a detector that behaves differently on a bad
day. `load_overrides` lets an operator supply authoritative data.
"""

from __future__ import annotations

import ipaddress
import json
from collections import defaultdict
from pathlib import Path

from .model import Edge, STRONG, SUSPECTED, WEAK

FIXED_LINE = "fixed-line"
MOBILE = "mobile"
HOSTING = "hosting"
UNKNOWN = "unknown"

# Published allocations for the carriers that appear in US merchant onboarding.
# Deliberately coarse: the question is only ever "can this address move between
# subscribers", and for a mobile pool the answer is yes.
RANGES = [
    ("172.32.0.0/11", MOBILE, "T-Mobile USA"),
    ("172.56.0.0/14", MOBILE, "T-Mobile USA"),
    ("174.192.0.0/10", MOBILE, "Verizon Wireless"),
    ("107.77.0.0/16", MOBILE, "AT&T Mobility"),
    ("166.128.0.0/10", MOBILE, "AT&T Mobility"),
    ("162.192.0.0/10", MOBILE, "Sprint/T-Mobile"),
    ("74.96.0.0/12", FIXED_LINE, "Verizon Internet Services"),
    ("173.48.0.0/12", FIXED_LINE, "Verizon Internet Services"),
    ("98.0.0.0/8", FIXED_LINE, "Comcast / mixed residential"),
    ("76.96.0.0/11", FIXED_LINE, "Comcast"),
    ("24.0.0.0/12", FIXED_LINE, "Comcast"),
    ("146.75.0.0/16", HOSTING, "Fastly"),
    ("104.16.0.0/12", HOSTING, "Cloudflare"),
    ("35.190.0.0/16", HOSTING, "Google Cloud"),
    ("52.0.0.0/8", HOSTING, "Amazon AWS"),
]

_COMPILED = [(ipaddress.ip_network(cidr, strict=False), kind, label)
             for cidr, kind, label in RANGES]


def load_overrides(path):
    """Replace the built-in table with authoritative data.

    Expected shape: [{"cidr": "...", "kind": "fixed-line|mobile|hosting",
    "label": "..."}]. An operator who has a real IP-intelligence feed should
    use it; the built-in table is a floor, not a ceiling.
    """
    global _COMPILED
    rows = json.loads(Path(path).read_text())
    _COMPILED = [(ipaddress.ip_network(r["cidr"]), r["kind"], r.get("label", "")) for r in rows]
    return len(_COMPILED)


def classify(address):
    """What kind of connection this address represents."""
    try:
        ip = ipaddress.ip_address(str(address).strip())
    except ValueError:
        return {"address": address, "kind": UNKNOWN, "label": "", "usable": False}
    if ip.is_private or ip.is_loopback or ip.is_reserved:
        return {"address": str(ip), "kind": UNKNOWN, "label": "private or reserved",
                "usable": False}
    for network, kind, label in _COMPILED:
        if ip in network:
            return {"address": str(ip), "kind": kind, "label": label,
                    "network": str(network), "usable": True}
    return {"address": str(ip), "kind": UNKNOWN, "label": "", "usable": True}


def shareable(address):
    """Is an exact repeat of this address worth asserting a connection over?

    A hosting address is a VPN, a proxy or an office egress used by thousands
    of people, so an exact match there says nothing about who was typing.
    """
    info = classify(address)
    if not info["usable"]:
        return False
    return info["kind"] in (FIXED_LINE, MOBILE, UNKNOWN)


def address_edges(observations, names=None, max_accounts=6):
    """Connections from addresses recorded against accounts.

    `observations` is an iterable of (account, address, context) where context
    is a short phrase such as "accepting terms" or "taking a payment", used
    verbatim in the statement so a reviewer knows what the address was doing.
    """
    names = names or {}
    grouped = defaultdict(lambda: defaultdict(set))
    for account, address, context in observations:
        if not address or not shareable(address):
            continue
        grouped[str(address).strip()][account].add(context or "connecting")

    edges = []
    for address, accounts in grouped.items():
        if not 2 <= len(accounts) <= max_accounts:
            continue
        info = classify(address)
        members = sorted(accounts)
        if info["kind"] == FIXED_LINE:
            tier = STRONG
            caveat = ("a fixed-line subscriber allocation, which identifies one premises "
                      "rather than a pool of rotating addresses")
        elif info["kind"] == MOBILE:
            tier = SUSPECTED
            caveat = (f"a mobile pool operated by {info['label'] or 'a mobile carrier'}, "
                      "where addresses are reassigned between subscribers, so this is a "
                      "lead rather than evidence of a shared connection")
        else:
            tier = SUSPECTED
            caveat = "an address of unknown type, so the strength of this link is unknown"

        for i, a in enumerate(members):
            for b in members[i + 1:]:
                doing_a = ", ".join(sorted(accounts[a]))
                doing_b = ", ".join(sorted(accounts[b]))
                edges.append(Edge(
                    a=a, b=b, kind="shared-address", tier=tier,
                    statement=(f"{names.get(a, a)} ({doing_a}) and {names.get(b, b)} "
                               f"({doing_b}) were both recorded at {address}, "
                               f"{caveat}."),
                    evidence={"identifier": address, "kind": info["kind"],
                              "carrier": info["label"], "accounts_sharing": len(members)}))
    return edges


def range_notes(observations, names=None):
    """Same-range observations, reported but never turned into edges.

    Two merchants on neighbouring T-Mobile addresses is the weakest thing in
    this package. It belongs in a report as context and must never make a
    cluster, which is why it returns notes rather than edges.
    """
    names = names or {}
    grouped = defaultdict(set)
    for account, address, _ in observations:
        info = classify(address)
        if info["kind"] != MOBILE or not info.get("network"):
            continue
        try:
            ip = ipaddress.ip_address(str(address).strip())
        except ValueError:
            continue
        grouped[str(ipaddress.ip_network(f"{ip}/16", strict=False))].add(account)

    notes = []
    for block, accounts in sorted(grouped.items()):
        if len(accounts) < 2:
            continue
        who = ", ".join(sorted(names.get(a, a) for a in accounts))
        notes.append((WEAK,
                      f"{who} were recorded on different addresses within the same mobile "
                      f"range ({block}). Mobile carriers assign these regionally, so this "
                      f"is context only and is not treated as a connection."))
    return notes
