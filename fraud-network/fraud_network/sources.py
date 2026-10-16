"""Load the committed data the linkage graph is built from.

Everything here is already in the repository, which matters for two reasons:
the detectors can be tested against the real historical fraud cases without
live credentials, and a scheduled run needs no new secrets.

payments-automation/data/transactions.csv is the full charge history across every
connected account, succeeded and failed, with card brand/funding/country/last4
and the terminal reader id. 58,058 rows, 164 transacting accounts at the time of
writing. It is the only source that carries declines, and the declines are where
the ring is visible.
"""

from __future__ import annotations

import csv
from datetime import datetime, timezone
from pathlib import Path

from .cards import card_key
from .model import Observation


def _epoch(value: str) -> int:
    value = (value or "").strip().replace("T", " ").replace("Z", "")
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return int(datetime.strptime(value, fmt).replace(tzinfo=timezone.utc).timestamp())
        except ValueError:
            continue
    raise ValueError(f"unparseable timestamp {value!r}")


def load_charges(path: str | Path) -> tuple[list[Observation], dict[str, str]]:
    """Read the charge export into observations plus an account -> name map."""
    observations: list[Observation] = []
    names: dict[str, str] = {}
    with open(path, newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            account = (row.get("CHARGE_ACCOUNT_ID") or "").strip()
            if not account.startswith("acct_"):
                continue
            name = (row.get("MERCHANT_NAME") or account).strip()
            names[account] = name
            try:
                amount = int(row.get("AMOUNT") or 0)
            except ValueError:
                amount = 0
            observations.append(Observation(
                account=account,
                name=name,
                created=_epoch(row.get("CREATED_AT", "")),
                amount=amount,
                currency=(row.get("CURRENCY") or "usd").lower(),
                status=(row.get("STATUS") or "").lower(),
                card_key=card_key(row.get("CARD_BRAND"), row.get("CARD_FUNDING"),
                                  row.get("CARD_COUNTRY"), row.get("CARD_LAST4")),
                reader=(row.get("TERMINAL_READER_ID") or "").strip() or None,
            ))
    observations.sort(key=lambda o: o.created)
    return observations, names


def load_address_observations(path):
    """Read account/IP observations recorded elsewhere.

    Shape: [{"account": "acct_...", "address": "...", "context": "accepting terms"}].
    IPs are not in the activation pull; they live in Stripe and in the risk
    monitor's encrypted state. Keeping this as a plain file means the graph
    never needs those credentials, and whatever produces the file can be
    changed without touching the detectors.
    """
    from pathlib import Path as _Path
    import json as _json
    p = _Path(path)
    if not p.exists():
        return []
    rows = _json.loads(p.read_text())
    return [(r["account"], r.get("address"), r.get("context", "connecting"))
            for r in rows if r.get("account")]


def load_document_manifest(path):
    """Read the merchant documents to examine.

    Shape: [{"account": "acct_...", "path": "/absolute/or/relative/file.pdf"}].
    Nothing confidential is committed: the manifest points at files a reviewer
    has already pulled from Gmail into a local working directory.
    """
    from pathlib import Path as _Path
    import json as _json
    p = _Path(path)
    if not p.exists():
        return []
    rows = _json.loads(p.read_text())
    out = []
    for row in rows:
        target = _Path(row.get("path", ""))
        if not target.is_absolute():
            target = p.parent / target
        if target.exists():
            out.append((row["account"], target))
    return out
