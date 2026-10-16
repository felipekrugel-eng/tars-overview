"""Turn the graph into something a person can read, check and act on.

The report is written for a reviewer who was not in the room when the cluster
formed and who has the authority to restrict a merchant. That shapes
everything here:

  * Every claim carries the evidence it rests on, in the same sentence.
  * Confirmed, strong and suspected are kept visually distinct, because the
    difference between "these accounts share an email address" and "these
    accounts opened on the same afternoon" is the difference between an action
    and a question.
  * Nothing in this file decides anything. It produces a document and an alert
    payload; a human restricts accounts.
"""

from __future__ import annotations

from datetime import datetime, timezone

from .identity import onboarding_profile
from .model import CONFIRMED, STRONG, SUSPECTED, TIER_ORDER

TIER_LABEL = {
    CONFIRMED: "Confirmed",
    STRONG: "Strong",
    SUSPECTED: "Suspected",
}

TIER_NOTE = {
    CONFIRMED: "A shared identifier that cannot occur by accident.",
    STRONG: "Technical evidence that the same hands control both accounts.",
    SUSPECTED: "A pattern worth a look. Not evidence on its own.",
}

# Mermaid draws confirmed and strong links solid, suspected ones dotted, so the
# shape of the picture matches the strength of the case.
ARROW = {CONFIRMED: "===", STRONG: "---", SUSPECTED: "-.-"}

# Strongest first, always: a reviewer who reads only the first two lines should
# have read the best evidence there is.
STRENGTH_FIRST = sorted(TIER_ORDER, key=lambda t: -TIER_ORDER[t])


def _when(epoch):
    if not epoch:
        return "unknown"
    return datetime.fromtimestamp(epoch, timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def _escape(text):
    return str(text).replace('"', "'").replace("\n", " ")


def mermaid(cluster, names, accounts=None):
    """A diagram of one investigation.

    Node ids are positional rather than account ids because Mermaid chokes on
    some identifier shapes, and the account id belongs in the label where a
    reviewer can copy it anyway.
    """
    accounts = accounts or {}
    nodes = list(cluster.members) + list(cluster.peripheral)
    index = {acct: f"N{i}" for i, acct in enumerate(nodes)}

    lines = ["```mermaid", "graph LR"]
    for acct in nodes:
        row = accounts.get(acct) or {}
        status = row.get("status")
        label = _escape(names.get(acct, acct))
        detail = _escape(acct[:18])
        caption = f"{label}<br/>{detail}" + (f"<br/>{_escape(status)}" if status else "")
        shape = f'("{caption}")' if acct in cluster.peripheral else f'["{caption}"]'
        lines.append(f"    {index[acct]}{shape}")

    seen = set()
    for edge in sorted(cluster.edges, key=lambda e: -TIER_ORDER[e.tier]):
        if edge.a not in index or edge.b not in index:
            continue
        key = (index[edge.a], index[edge.b], edge.kind)
        if key in seen:
            continue
        seen.add(key)
        arrow = ARROW.get(edge.tier, "-.-")
        lines.append(f'    {index[edge.a]} {arrow}|"{_escape(edge.kind)}"| {index[edge.b]}')

    for acct in cluster.members:
        if (accounts.get(acct) or {}).get("status") == "Enabled":
            lines.append(f"    style {index[acct]} stroke-width:3px")
    lines.append("```")
    return "\n".join(lines)


def _members_table(cluster, names, accounts):
    rows = ["| Account | Stripe id | Status | Onboarded |",
            "| --- | --- | --- | --- |"]
    for acct in cluster.members + cluster.peripheral:
        row = accounts.get(acct) or {}
        marker = "" if acct in cluster.members else " _(peripheral)_"
        new = " **new**" if acct in cluster.new_members else ""
        rows.append(f"| {names.get(acct, acct)}{marker}{new} | `{acct}` | "
                    f"{row.get('status') or 'unknown'} | {row.get('connected') or 'unknown'} |")
    return "\n".join(rows)


def investigation(cluster, names, accounts, profile=None):
    """One investigation, start to finish."""
    profile = profile or (onboarding_profile(accounts, cluster.members) if accounts else None)
    paragraphs = [f"Opened {_when(cluster.created_at)}."]

    still_on = [m for m in cluster.members
                if (accounts.get(m) or {}).get("status") == "Enabled"]
    if still_on:
        paragraphs.append(f"**{len(still_on)} of these accounts can still take payments.** "
                          "That is the exposure this investigation is about.")

    if cluster.merged_from:
        paragraphs.append(
            f"Absorbed earlier investigation(s): {', '.join(cluster.merged_from)}. "
            "Accounts previously tracked separately are now known to be connected.")
    if cluster.new_members:
        names_new = ", ".join(names.get(m, m) for m in cluster.new_members)
        paragraphs.append(f"**New since the last run:** {names_new}.")

    if profile and profile.get("burst"):
        paragraphs.append(
            f"Every member was opened within {profile['span_days']} days of the others.")
    elif profile:
        paragraphs.append(f"Members were opened over {profile['span_days']} days.")

    out = [f"## {cluster.id} — {len(cluster.members)} accounts, {cluster.strength()} evidence", ""]
    for paragraph in paragraphs:
        out += [paragraph, ""]
    out += [_members_table(cluster, names, accounts), "", "### Evidence", ""]

    for tier in STRENGTH_FIRST:
        group = [e for e in cluster.edges if e.tier == tier]
        if not group:
            continue
        out.append(f"**{TIER_LABEL.get(tier, tier)}** — {TIER_NOTE.get(tier, '')}")
        out.append("")
        for edge in sorted(group, key=lambda e: (e.kind, e.a, e.b)):
            out.append(f"- {edge.statement}")
        out.append("")

    out += ["<details><summary>Evidence annex — raw values</summary>", ""]
    for edge in sorted(cluster.edges, key=lambda e: (-TIER_ORDER[e.tier], e.kind)):
        out.append(f"- `{edge.kind}` `{edge.tier}` `{edge.a}` `{edge.b}` — "
                   + ", ".join(f"{k}={v}" for k, v in sorted(edge.evidence.items())))
    out += ["", "</details>", "", mermaid(cluster, names, accounts), ""]
    return "\n".join(out)


def render(clusters, names, accounts, leads=None, now=None, previous_ids=None):
    """The whole report."""
    leads = leads or []
    previous_ids = set(previous_ids or [])
    opened = [c for c in clusters if c.id not in previous_ids] if previous_ids else []
    grown = [c for c in clusters if c.new_members and c.id in previous_ids]

    out = ["# Cross-account fraud network",
           "",
           f"Generated {_when(now)}. "
           f"{len(clusters)} open investigation(s) covering "
           f"{sum(len(c.members) for c in clusters)} accounts, plus {len(leads)} unattached lead(s).",
           "",
           "This report identifies connections. It does not restrict, pause or contact "
           "anyone, and no account should be actioned on the strength of a suspected-tier "
           "line alone.",
           ""]

    if opened or grown:
        out.append("## What changed")
        out.append("")
        for c in opened:
            out.append(f"- **{c.id} opened** — {len(c.members)} accounts, "
                       f"{c.strength()} evidence.")
        for c in grown:
            joined = ", ".join(names.get(m, m) for m in c.new_members)
            out.append(f"- **{c.id} grew** — {joined} joined.")
        out.append("")

    for cluster in sorted(clusters, key=lambda c: (-len(c.members), c.id)):
        profile = None
        out.append(investigation(cluster, names, accounts, profile))

    if leads:
        out += ["## Leads",
                "",
                "Suspected-tier pairs with no investigation behind them. Each is one "
                "person's glance, not a case. Most are a shop opening a second till.",
                ""]
        for edge in leads:
            out.append(f"- {edge.statement}")
        out.append("")

    return "\n".join(out)


def alerts(clusters, names, previous_ids=None, previous_edges=None):
    """What is worth waking somebody for.

    Deliberately narrow. An alert that fires on every suspected pair gets
    muted within a week, and then the one that mattered is muted too.
    """
    previous_ids = set(previous_ids or [])
    previous_edges = set(previous_edges or [])
    out = []
    for cluster in clusters:
        if cluster.id not in previous_ids:
            out.append({
                "kind": "investigation-opened",
                "investigation": cluster.id,
                "accounts": cluster.members,
                "strength": cluster.strength(),
                "summary": (f"{cluster.id}: {len(cluster.members)} accounts connected by "
                            f"{cluster.strength()} evidence."),
                "evidence": [e.statement for e in cluster.edges
                             if e.tier in (CONFIRMED, STRONG)],
            })
            continue
        joined = [e for e in cluster.edges
                  if e.key not in previous_edges and e.tier in (CONFIRMED, STRONG)]
        if cluster.new_members or joined:
            who = ", ".join(names.get(m, m) for m in cluster.new_members) or "no new accounts"
            out.append({
                "kind": "investigation-grew",
                "investigation": cluster.id,
                "accounts": cluster.members,
                "new_accounts": cluster.new_members,
                "strength": cluster.strength(),
                "summary": f"{cluster.id} grew: {who}.",
                "evidence": [e.statement for e in joined],
            })
    return out
