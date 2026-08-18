#!/usr/bin/env python3
"""
build_ads_data.py — regenerate "KPI Dashboard v2 (Caio)/ads-data.js" from the
Google Ads export sheet.

WHY THIS EXISTS
---------------
The marketing dashboard originally ran as a standalone page that fetched the
Google Sheet directly from the browser on a 5-minute timer. That meant (a) the
sheet had to stay readable by unauthenticated requests, and (b) the page only
ever showed whatever was currently in the sheet. This script moves the fetch
server-side, exactly like every other FACADASH data file: an Action pulls, this
builds a committed .js, and the page is fully static at serve time.

TWO SIDE EFFECTS THAT ARE THE WHOLE POINT
  1. The sheet can be locked down. Only this job needs access.
  2. History accumulates. The export sheet holds a short rolling window; we merge
     each pull into whatever ads-data.js already had, keyed on the natural grain,
     so the dashboard keeps days the sheet has already dropped.

SOURCES — the API is the destination, the sheet is the interim
  Ad spend is not in LOYVERSE_DATA_LAKE, so this reads from Google directly.
  Two sources are supported and the choice is automatic (see ADS_SOURCE):

  * "api" — the Google Ads API, read straight from the account. Preferred.
    Drops the spreadsheet out of the loop entirely, returns typed numbers
    instead of locale-formatted strings, fails loudly instead of silently, and
    can re-query history on demand rather than depending on accumulated state.
    Needs a developer token, which needs a manager (MCC) account — see
    "Marketing Tab — Google Ads API Setup.md".

  * "sheet" — Robson's export spreadsheet, fetched server-side. What shipped
    first, because it needed no credentials. Keep until the API path is
    verified against real numbers, then delete.

  Sheet auth has its own two modes: a service account via
  GOOGLE_SERVICE_ACCOUNT_JSON (which is what allows the sheet to be locked
  down), else the public CSV export, which only works while the sheet is
  link-readable and is the reason the sheet is currently world-readable.

Usage:
    python kpi-automation/build_ads_data.py

Environment:
    ADS_SOURCE                   "auto" (default) | "api" | "sheet".
                                 "auto" uses the API when it is configured.
  sheet source:
    ADS_SHEET_ID                 spreadsheet id (default: the Google Ads export)
    GOOGLE_SERVICE_ACCOUNT_JSON  service-account key JSON (optional)
  api source:
    GOOGLE_ADS_DEVELOPER_TOKEN   from the MCC's API Center
    GOOGLE_ADS_CLIENT_ID         OAuth client id
    GOOGLE_ADS_CLIENT_SECRET     OAuth client secret
    GOOGLE_ADS_REFRESH_TOKEN     refresh token minted once by an Ads admin
    GOOGLE_ADS_CUSTOMER_ID       account to report on, digits only
    GOOGLE_ADS_LOGIN_CUSTOMER_ID MCC id, digits only (needed when the token
                                 belongs to a manager account)
    ADS_API_VERSION              default below; bump when a version sunsets
    ADS_API_LOOKBACK_DAYS        days re-queried each run (default 90)
  both:
    V2_DIR                       output dir (default: "KPI Dashboard v2 (Caio)")
    ADS_HISTORY_DAYS             retention window, days (default 400)
"""

from __future__ import annotations

import csv
import io
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

# --- config -----------------------------------------------------------------
#
# GitHub Actions passes an unset workflow_dispatch input as an empty string, not
# as an absent variable, so os.environ.get(name, default) returns "" and int("")
# raises. Every tunable below goes through these two helpers for that reason.


def _env_str(name: str, default: str) -> str:
    return os.environ.get(name, "").strip() or default


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        print(f"! {name}={raw!r} is not an integer — using {default}")
        return default


SHEET_ID = os.environ.get(
    "ADS_SHEET_ID", "1xgbK3Ic9NP2Wv_kiF3nZMoA6ozaHbmRA6tdqLysQRck"
)

# Tab names as Robson's export writes them (Portuguese). Mapped to English in the
# record keys below so nothing Portuguese reaches the UI.
TABS = {
    "daily": "Campanhas_Diario",
    "events": "Conversoes_Diario",
    "campaigns": "Resumo_Campanhas",
}

REPO_ROOT = Path(__file__).resolve().parent.parent
V2_DIR = Path(os.environ.get("V2_DIR", REPO_ROOT / "KPI Dashboard v2 (Caio)"))
OUT_PATH = V2_DIR / "ads-data.js"

HISTORY_DAYS = _env_int("ADS_HISTORY_DAYS", 400)

# Which source to read. "auto" prefers the API whenever it is fully configured,
# so flipping over is a matter of adding secrets, not editing code.
ADS_SOURCE = _env_str("ADS_SOURCE", "auto").lower()

# Google Ads API. Versions live ~1 year and Google moved to monthly releases in
# January 2026, so this WILL need bumping; that is why it is one constant and an
# env override rather than a string buried in a URL. v25 shipped 22 July 2026 and
# sunsets August 2027.
ADS_API_VERSION = _env_str("ADS_API_VERSION", "v25")
ADS_API_ROOT = "https://googleads.googleapis.com"
OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token"

# How far back each run re-asks for. Needs to be wide enough to catch Google
# restating conversions after the fact, but there is no reason to re-pull a year
# every three hours — the committed file already holds it.
ADS_API_LOOKBACK_DAYS = _env_int("ADS_API_LOOKBACK_DAYS", 90)

# Natural keys — what makes a row unique. A re-pull of the same key overwrites,
# because Google Ads restates recent days as conversions land late.
DAILY_KEY = ("date", "campaignId")
EVENT_KEY = ("date", "campaignId", "action")


# --- fetching ---------------------------------------------------------------


def _fetch_tab_public(tab: str) -> list[list[str]]:
    """Fetch one tab as CSV via the gviz export endpoint (no auth)."""
    url = (
        f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq"
        f"?tqx=out:csv&sheet={urllib.parse.quote(tab)}"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "facadash-ads-pull/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = resp.read().decode("utf-8", errors="replace")
    if body.lstrip().startswith("<"):
        raise RuntimeError(
            f"Tab {tab!r} returned HTML, not CSV — the sheet is not publicly "
            "readable. Configure GOOGLE_SERVICE_ACCOUNT_JSON and share the sheet "
            "with the service account instead."
        )
    return list(csv.reader(io.StringIO(body)))


def _fetch_tab_service_account(tab: str, creds) -> list[list[str]]:
    """Fetch one tab through the Sheets API using a service account."""
    from googleapiclient.discovery import build  # imported lazily

    service = build("sheets", "v4", credentials=creds, cache_discovery=False)
    result = (
        service.spreadsheets()
        .values()
        .get(spreadsheetId=SHEET_ID, range=f"'{tab}'")
        .execute()
    )
    return result.get("values", [])


def load_tabs() -> tuple[dict[str, list[list[str]]], str]:
    """Return {logical_name: rows} plus a short description of the auth used."""
    sa_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    if sa_json:
        from google.oauth2 import service_account  # imported lazily

        info = json.loads(sa_json)
        creds = service_account.Credentials.from_service_account_info(
            info, scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"]
        )
        rows = {k: _fetch_tab_service_account(v, creds) for k, v in TABS.items()}
        return rows, f"service account {info.get('client_email', '?')}"

    rows = {k: _fetch_tab_public(v) for k, v in TABS.items()}
    return rows, "public CSV export (sheet is link-readable)"


# --- Google Ads API source --------------------------------------------------
#
# Deliberately REST-over-urllib rather than the google-ads client library. The
# library pins a major API version per release and pulls in grpc and protobuf;
# here the entire surface is two GAQL queries, so the dependency would cost more
# than it saves and would couple version bumps to a pip upgrade. Everything
# version-specific is ADS_API_VERSION above.
#
# One proto3-JSON gotcha drives the parsing below: int64 fields come back as
# JSON *strings*, so metrics.impressions is "78344", not 78344. _num handles it.

API_ENV = (
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_REFRESH_TOKEN",
    "GOOGLE_ADS_CUSTOMER_ID",
)


def api_configured() -> bool:
    return all(os.environ.get(name, "").strip() for name in API_ENV)


def api_missing() -> list[str]:
    return [name for name in API_ENV if not os.environ.get(name, "").strip()]


def _digits(value: str) -> str:
    """Customer ids are often pasted as 123-456-7890; the API wants digits."""
    return "".join(ch for ch in str(value) if ch.isdigit())


def _access_token() -> str:
    """Trade the long-lived refresh token for a short-lived access token."""
    payload = urllib.parse.urlencode(
        {
            "client_id": os.environ["GOOGLE_ADS_CLIENT_ID"].strip(),
            "client_secret": os.environ["GOOGLE_ADS_CLIENT_SECRET"].strip(),
            "refresh_token": os.environ["GOOGLE_ADS_REFRESH_TOKEN"].strip(),
            "grant_type": "refresh_token",
        }
    ).encode()
    req = urllib.request.Request(
        OAUTH_TOKEN_URL,
        data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="replace")[:400]
        raise RuntimeError(
            "OAuth refresh failed. The refresh token is usually the culprit: it "
            "is revoked if the Google account password changes, if the OAuth "
            "consent screen is still in Testing mode (those expire after 7 "
            f"days), or if the client id/secret no longer match. Google said: {detail}"
        ) from err
    token = body.get("access_token", "")
    if not token:
        raise RuntimeError(f"OAuth refresh returned no access_token: {body}")
    return token


def _gaql(query: str, token: str) -> list[dict]:
    """Run one GAQL query through searchStream and return the flat result rows."""
    customer = _digits(os.environ["GOOGLE_ADS_CUSTOMER_ID"])
    url = f"{ADS_API_ROOT}/{ADS_API_VERSION}/customers/{customer}/googleAds:searchStream"
    headers = {
        "Authorization": f"Bearer {token}",
        "developer-token": os.environ["GOOGLE_ADS_DEVELOPER_TOKEN"].strip(),
        "Content-Type": "application/json",
    }
    login_cid = _digits(os.environ.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID", ""))
    if login_cid:
        headers["login-customer-id"] = login_cid

    req = urllib.request.Request(
        url, data=json.dumps({"query": query}).encode("utf-8"), headers=headers
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="replace")[:600]
        hint = ""
        if err.code == 404:
            hint = (
                f" A 404 here usually means API version {ADS_API_VERSION} has "
                "sunset — check the release notes and set ADS_API_VERSION."
            )
        elif err.code in (401, 403):
            hint = (
                " Check the developer token's access level, that "
                "GOOGLE_ADS_LOGIN_CUSTOMER_ID is the MCC, and that the OAuth "
                "user can see the account."
            )
        raise RuntimeError(f"Ads API {err.code} on searchStream.{hint} {detail}") from err

    # searchStream answers with an array of chunks, each holding "results".
    chunks = body if isinstance(body, list) else [body]
    rows: list[dict] = []
    for chunk in chunks:
        rows.extend(chunk.get("results", []) or [])
    return rows


def _dig(row: dict, *path, default=""):
    """Walk camelCase response keys without exploding on absent branches."""
    node = row
    for key in path:
        if not isinstance(node, dict) or key not in node:
            return default
        node = node[key]
    return node if node is not None else default


def _date_window() -> tuple[str, str]:
    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=ADS_API_LOOKBACK_DAYS)
    return start.strftime("%Y-%m-%d"), today.strftime("%Y-%m-%d")


def load_from_api() -> tuple[list[dict], list[dict], list[dict], str, str]:
    """Return (daily, events, campaigns, auth_desc, currency) from the Ads API."""
    token = _access_token()
    since, until = _date_window()
    customer = _digits(os.environ["GOOGLE_ADS_CUSTOMER_ID"])
    print(f"  querying customer {customer} for {since} → {until}")

    daily_rows = _gaql(
        "SELECT campaign.id, campaign.name, campaign.status, "
        "campaign.advertising_channel_type, campaign.advertising_channel_sub_type, "
        "customer.currency_code, segments.date, "
        "metrics.impressions, metrics.clicks, metrics.cost_micros, "
        "metrics.interactions, metrics.conversions, metrics.conversions_value, "
        "metrics.all_conversions, metrics.all_conversions_value "
        "FROM campaign "
        f"WHERE segments.date BETWEEN '{since}' AND '{until}' "
        "ORDER BY segments.date",
        token,
    )

    currency = ""
    daily: list[dict] = []
    for row in daily_rows:
        currency = currency or _dig(row, "customer", "currencyCode")
        daily.append(
            {
                "date": _date(_dig(row, "segments", "date")),
                "campaignId": str(_dig(row, "campaign", "id")),
                "campaign": str(_dig(row, "campaign", "name")),
                "status": str(_dig(row, "campaign", "status")).upper(),
                "channel": str(_dig(row, "campaign", "advertisingChannelType")),
                "subtype": str(_dig(row, "campaign", "advertisingChannelSubType")),
                "currency": _dig(row, "customer", "currencyCode") or "USD",
                "impressions": _num(_dig(row, "metrics", "impressions", default=0)),
                "clicks": _num(_dig(row, "metrics", "clicks", default=0)),
                # cost_micros is micros of the account currency, always.
                "cost": _num(_dig(row, "metrics", "costMicros", default=0)) / 1_000_000.0,
                "conversions": _num(_dig(row, "metrics", "conversions", default=0)),
                "convValue": _num(_dig(row, "metrics", "conversionsValue", default=0)),
                "allConversions": _num(_dig(row, "metrics", "allConversions", default=0)),
                "allConvValue": _num(_dig(row, "metrics", "allConversionsValue", default=0)),
                "interactions": _num(_dig(row, "metrics", "interactions", default=0)),
            }
        )

    # Conversion actions come from a separate query because segmenting by
    # conversion action makes cost/impressions/clicks invalid to select — Google
    # does not attribute spend per conversion event. That is a platform fact, not
    # a limitation of this pull, and it is why the page shows blended cost.
    event_rows = _gaql(
        "SELECT campaign.id, campaign.name, segments.date, "
        "segments.conversion_action_name, segments.conversion_action_category, "
        "metrics.conversions, metrics.conversions_value, "
        "metrics.all_conversions, metrics.all_conversions_value "
        "FROM campaign "
        f"WHERE segments.date BETWEEN '{since}' AND '{until}' "
        "ORDER BY segments.date",
        token,
    )
    events: list[dict] = []
    for row in event_rows:
        action = str(_dig(row, "segments", "conversionActionName"))
        if not action:
            continue
        events.append(
            {
                "date": _date(_dig(row, "segments", "date")),
                "campaignId": str(_dig(row, "campaign", "id")),
                "campaign": str(_dig(row, "campaign", "name")),
                "action": action,
                "category": str(_dig(row, "segments", "conversionActionCategory")).upper(),
                "conversions": _num(_dig(row, "metrics", "conversions", default=0)),
                "convValue": _num(_dig(row, "metrics", "conversionsValue", default=0)),
                "allConversions": _num(_dig(row, "metrics", "allConversions", default=0)),
                "allConvValue": _num(_dig(row, "metrics", "allConversionsValue", default=0)),
            }
        )

    meta_rows = _gaql(
        "SELECT campaign.id, campaign.name, campaign.status, "
        "campaign.advertising_channel_type, campaign.advertising_channel_sub_type, "
        "campaign.bidding_strategy_type, campaign_budget.amount_micros, "
        "customer.currency_code "
        "FROM campaign",
        token,
    )
    campaigns: list[dict] = []
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for row in meta_rows:
        cid = str(_dig(row, "campaign", "id"))
        if not cid:
            continue
        currency = currency or _dig(row, "customer", "currencyCode")
        campaigns.append(
            {
                "campaignId": cid,
                "campaign": str(_dig(row, "campaign", "name")),
                "status": str(_dig(row, "campaign", "status")).upper(),
                "channel": str(_dig(row, "campaign", "advertisingChannelType")),
                "subtype": str(_dig(row, "campaign", "advertisingChannelSubType")),
                "bidStrategy": str(_dig(row, "campaign", "biddingStrategyType")),
                "dailyBudget": _num(_dig(row, "campaignBudget", "amountMicros", default=0))
                / 1_000_000.0,
                "currency": _dig(row, "customer", "currencyCode") or "USD",
                "updatedAt": now,
            }
        )

    desc = f"Google Ads API {ADS_API_VERSION}, customer {customer}"
    if _digits(os.environ.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID", "")):
        desc += f" via MCC {_digits(os.environ['GOOGLE_ADS_LOGIN_CUSTOMER_ID'])}"
    return daily, events, campaigns, desc, (currency or "USD")


# --- parsing ----------------------------------------------------------------


def _num(value) -> float:
    """Parse a sheet cell to a float, tolerating blanks, %, and , decimals."""
    if value is None:
        return 0.0
    text = str(value).strip().replace("%", "")
    if not text:
        return 0.0
    # "1.234,56" (pt-BR) -> "1234.56"; "1,234.56" (en) -> "1234.56"
    if "," in text and "." in text:
        text = (
            text.replace(".", "").replace(",", ".")
            if text.rfind(",") > text.rfind(".")
            else text.replace(",", "")
        )
    elif "," in text:
        text = text.replace(",", ".") if len(text.split(",")[-1]) != 3 else text.replace(",", "")
    try:
        return float(text)
    except ValueError:
        return 0.0


def _date(value) -> str:
    """Normalise a sheet date cell to YYYY-MM-DD, dropping any time part."""
    text = str(value or "").strip()
    if not text:
        return ""
    text = text.split(" ")[0].split("T")[0]
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(text, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return text


def _index_header(header: list[str]) -> dict[str, int]:
    return {str(h).strip().lower(): i for i, h in enumerate(header)}


def _get(row: list[str], idx: dict[str, int], *names: str):
    """First matching column by lowercase header name."""
    for name in names:
        i = idx.get(name)
        if i is not None and i < len(row):
            return row[i]
    return ""


def parse_daily(rows: list[list[str]]) -> list[dict]:
    if not rows:
        return []
    idx = _index_header(rows[0])
    out = []
    for row in rows[1:]:
        if not any(str(c).strip() for c in row):
            continue
        date = _date(_get(row, idx, "data", "date"))
        if not date:
            continue
        out.append(
            {
                "date": date,
                "campaignId": str(_get(row, idx, "id campanha", "campaign id")).strip(),
                "campaign": str(_get(row, idx, "nome campanha", "campaign name")).strip(),
                "status": str(_get(row, idx, "status")).strip().upper(),
                "channel": str(_get(row, idx, "canal", "channel")).strip(),
                "subtype": str(_get(row, idx, "subtipo", "subtype")).strip(),
                "currency": str(_get(row, idx, "moeda", "currency")).strip() or "USD",
                "impressions": _num(_get(row, idx, "impressoes", "impressions")),
                "clicks": _num(_get(row, idx, "cliques", "clicks")),
                "cost": _num(_get(row, idx, "custo", "cost")),
                "conversions": _num(_get(row, idx, "conversoes", "conversions")),
                "convValue": _num(_get(row, idx, "valor conversoes")),
                "allConversions": _num(_get(row, idx, "todas conversoes")),
                "allConvValue": _num(_get(row, idx, "valor todas conversoes")),
                "interactions": _num(_get(row, idx, "interacoes", "interactions")),
            }
        )
    return out


def parse_events(rows: list[list[str]]) -> list[dict]:
    if not rows:
        return []
    idx = _index_header(rows[0])
    out = []
    for row in rows[1:]:
        if not any(str(c).strip() for c in row):
            continue
        date = _date(_get(row, idx, "data", "date"))
        action = str(_get(row, idx, "acao de conversao", "conversion action")).strip()
        if not date or not action:
            continue
        out.append(
            {
                "date": date,
                "campaignId": str(_get(row, idx, "id campanha", "campaign id")).strip(),
                "campaign": str(_get(row, idx, "nome campanha", "campaign name")).strip(),
                "action": action,
                "category": str(_get(row, idx, "categoria da acao", "category")).strip().upper(),
                "conversions": _num(_get(row, idx, "conversoes", "conversions")),
                "convValue": _num(_get(row, idx, "valor conversoes")),
                "allConversions": _num(_get(row, idx, "todas conversoes")),
                "allConvValue": _num(_get(row, idx, "valor todas conversoes")),
            }
        )
    return out


def parse_campaigns(rows: list[list[str]]) -> list[dict]:
    if not rows:
        return []
    idx = _index_header(rows[0])
    out = []
    for row in rows[1:]:
        if not any(str(c).strip() for c in row):
            continue
        cid = str(_get(row, idx, "id campanha", "campaign id")).strip()
        if not cid:
            continue
        out.append(
            {
                "campaignId": cid,
                "campaign": str(_get(row, idx, "nome campanha", "campaign name")).strip(),
                "status": str(_get(row, idx, "status")).strip().upper(),
                "channel": str(_get(row, idx, "canal", "channel")).strip(),
                "subtype": str(_get(row, idx, "subtipo", "subtype")).strip(),
                "bidStrategy": str(_get(row, idx, "estrategia de lance", "bid strategy")).strip(),
                "dailyBudget": _num(_get(row, idx, "orcamento diario", "daily budget")),
                "currency": str(_get(row, idx, "moeda", "currency")).strip() or "USD",
                "updatedAt": str(_get(row, idx, "atualizado em", "updated")).strip(),
            }
        )
    return out


# --- history merge ----------------------------------------------------------


def read_existing() -> dict:
    """Load the previously committed ads-data.js so history survives the pull."""
    if not OUT_PATH.exists():
        return {}
    text = OUT_PATH.read_text(encoding="utf-8")
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return {}
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        print("! existing ads-data.js was not parseable — starting history fresh")
        return {}


def merge(old: list[dict], new: list[dict], key: tuple[str, ...]) -> list[dict]:
    """New rows win on collision (Google Ads restates recent days)."""
    merged = {tuple(r.get(k, "") for k in key): r for r in old}
    merged.update({tuple(r.get(k, "") for k in key): r for r in new})
    return sorted(merged.values(), key=lambda r: (r.get("date", ""), r.get("campaignId", "")))


def trim(rows: list[dict]) -> list[dict]:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=HISTORY_DAYS)).strftime("%Y-%m-%d")
    return [r for r in rows if r.get("date", "") >= cutoff]


# --- main -------------------------------------------------------------------


def resolve_source() -> str:
    """Decide between the API and the sheet, and say so out loud."""
    if ADS_SOURCE == "api":
        if not api_configured():
            raise RuntimeError(
                "ADS_SOURCE=api but these are unset: " + ", ".join(api_missing())
            )
        return "api"
    if ADS_SOURCE == "sheet":
        return "sheet"
    if ADS_SOURCE != "auto":
        raise RuntimeError(f"ADS_SOURCE must be auto, api or sheet — got {ADS_SOURCE!r}")
    if api_configured():
        return "api"
    print(f"  (API not configured — missing {', '.join(api_missing())})")
    return "sheet"


def main() -> int:
    source = resolve_source()

    if source == "api":
        print(f"Reading the Google Ads API ({ADS_API_VERSION})")
        daily_new, events_new, campaigns, auth_mode, currency = load_from_api()
        source_label = f"Google Ads API {ADS_API_VERSION}"
        empty_warning = (
            "! the API returned no campaign-day rows — refusing to overwrite good "
            "data. Either the account genuinely spent nothing in the window, or "
            "GOOGLE_ADS_CUSTOMER_ID points at a manager account instead of the "
            "account that runs the campaigns."
        )
    else:
        print(f"Reading sheet {SHEET_ID}")
        tabs, auth_mode = load_tabs()
        daily_new = parse_daily(tabs["daily"])
        events_new = parse_events(tabs["events"])
        campaigns = parse_campaigns(tabs["campaigns"])
        currency = ""
        source_label = "Google Ads export sheet"
        empty_warning = "! the daily tab came back empty — refusing to overwrite good data"

    print(f"  auth: {auth_mode}")
    print(
        f"  pulled: {len(daily_new)} daily, {len(events_new)} event, "
        f"{len(campaigns)} campaign rows"
    )

    if not daily_new:
        print(empty_warning)
        return 1

    prev = read_existing()
    daily = trim(merge(prev.get("daily", []), daily_new, DAILY_KEY))
    events = trim(merge(prev.get("events", []), events_new, EVENT_KEY))

    # Campaign metadata is a snapshot, not a time series: keep any campaign the
    # sheet has stopped listing so historical rows still resolve to a name.
    campaign_map = {c["campaignId"]: c for c in prev.get("campaigns", [])}
    campaign_map.update({c["campaignId"]: c for c in campaigns})
    for row in daily:
        cid = row["campaignId"]
        if cid and cid not in campaign_map:
            campaign_map[cid] = {
                "campaignId": cid,
                "campaign": row["campaign"],
                "status": row["status"],
                "channel": row["channel"],
                "subtype": row["subtype"],
                "bidStrategy": "",
                "dailyBudget": 0,
                "currency": row["currency"],
                "updatedAt": "",
            }

    gained = len(daily) - len(prev.get("daily", []))
    dates = [r["date"] for r in daily]
    payload = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": source_label,
        # Kept even on the API path so a stale file's provenance stays readable.
        "sheetId": SHEET_ID if source == "sheet" else "",
        "authMode": auth_mode,
        "currency": (currency or daily[-1].get("currency") or "USD"),
        "dateMin": min(dates) if dates else "",
        "dateMax": max(dates) if dates else "",
        "campaigns": sorted(campaign_map.values(), key=lambda c: c["campaign"]),
        "daily": daily,
        "events": events,
    }

    V2_DIR.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        "// Generated by kpi-automation/build_ads_data.py — do not edit by hand.\n"
        f"// Generated {payload['generatedAt']} from the Google Ads export sheet.\n"
        "window.ADS_DATA = "
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )

    print(
        f"Wrote {OUT_PATH} — {len(daily)} daily rows ({gained:+d}), "
        f"{len(events)} event rows, {len(payload['campaigns'])} campaigns, "
        f"{payload['dateMin']} → {payload['dateMax']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
