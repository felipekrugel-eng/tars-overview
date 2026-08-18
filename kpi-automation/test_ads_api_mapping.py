#!/usr/bin/env python3
"""
Verify the Ads API response mapping in build_ads_data.py without credentials.

Run:  python3 kpi-automation/test_ads_api_mapping.py

The live call can't be tested here, but the part most likely to be silently
wrong can be: proto3 JSON returns int64 fields as strings and money as micros,
so a mapping bug would show up as plausible-looking numbers that are off by
1e6 or coerced to zero. This feeds hand-built responses shaped exactly like
the API's and checks the records that come out.
"""

import importlib.util
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

os.environ.update(
    {
        "GOOGLE_ADS_DEVELOPER_TOKEN": "fake-token-22-chars-xx",
        "GOOGLE_ADS_CLIENT_ID": "fake.apps.googleusercontent.com",
        "GOOGLE_ADS_CLIENT_SECRET": "fake-secret",
        "GOOGLE_ADS_REFRESH_TOKEN": "fake-refresh",
        "GOOGLE_ADS_CUSTOMER_ID": "123-456-7890",
        "GOOGLE_ADS_LOGIN_CUSTOMER_ID": "999-888-7777",
        "ADS_SOURCE": "api",
    }
)

spec = importlib.util.spec_from_file_location(
    "bad", os.path.join(REPO, "kpi-automation", "build_ads_data.py")
)
bad = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bad)

fails = []


def check(label, got, want):
    ok = got == want
    print(f"{'pass' if ok else 'FAIL'}  {label}: {got!r}" + ("" if ok else f" != {want!r}"))
    if not ok:
        fails.append(label)


# --- responses shaped the way the API actually answers ----------------------
# int64 as strings, doubles as numbers, camelCase keys, cost in micros.
DAILY = [
    {
        "campaign": {
            "id": "22334455",
            "name": "LV | Search | BR | Brand",
            "status": "ENABLED",
            "advertisingChannelType": "SEARCH",
            "advertisingChannelSubType": "SEARCH_MOBILE_APP",
        },
        "customer": {"currencyCode": "USD"},
        "segments": {"date": "2026-08-17"},
        "metrics": {
            "impressions": "40000",
            "clicks": "800",
            "costMicros": "416565000",
            "interactions": "800",
            "conversions": 400.5,
            "conversionsValue": 0.0,
            "allConversions": 530.25,
            "allConversionsValue": 0.0,
        },
    },
    {
        "campaign": {"id": "22334455", "name": "LV | Search | BR | Brand", "status": "ENABLED"},
        "customer": {"currencyCode": "USD"},
        "segments": {"date": "2026-08-18"},
        # A zero-spend day: Google omits absent metrics entirely.
        "metrics": {"impressions": "12", "clicks": "0"},
    },
]

EVENTS = [
    {
        "campaign": {"id": "22334455", "name": "LV | Search | BR | Brand"},
        "segments": {
            "date": "2026-08-17",
            "conversionActionName": "loyverse-pos-android - com.loyverse.sale (Android) receipt_paid",
            "conversionActionCategory": "PURCHASE",
        },
        "metrics": {"conversions": 120.0, "allConversions": 133.0},
    },
    {  # no action name — must be dropped, not emitted with an empty key
        "campaign": {"id": "22334455"},
        "segments": {"date": "2026-08-17"},
        "metrics": {"conversions": 9.0},
    },
]

META = [
    {
        "campaign": {
            "id": "22334455",
            "name": "LV | Search | BR | Brand",
            "status": "ENABLED",
            "advertisingChannelType": "SEARCH",
            "biddingStrategyType": "TARGET_SPEND",
        },
        "campaignBudget": {"amountMicros": "50000000"},
        "customer": {"currencyCode": "USD"},
    }
]

calls = []


def fake_gaql(query, token):
    calls.append(query)
    if "conversion_action_name" in query:
        return EVENTS
    if "segments.date BETWEEN" in query:
        return DAILY
    return META


bad._access_token = lambda: "fake-access-token"
bad._gaql = fake_gaql

daily, events, campaigns, desc, currency = bad.load_from_api()

print("\n--- daily ---")
check("daily row count", len(daily), 2)
d0 = daily[0]
check("impressions parsed from int64 string", d0["impressions"], 40000.0)
check("clicks parsed from int64 string", d0["clicks"], 800.0)
check("costMicros converted to currency units", d0["cost"], 416.565)
check("conversions kept as double", d0["conversions"], 400.5)
check("allConversions kept as double", d0["allConversions"], 530.25)
check("channel mapped", d0["channel"], "SEARCH")
check("subtype mapped", d0["subtype"], "SEARCH_MOBILE_APP")
check("campaignId is a string", d0["campaignId"], "22334455")
check("date normalised", d0["date"], "2026-08-17")
check("missing metrics default to 0, not crash", daily[1]["cost"], 0.0)
check("missing subtype defaults to empty", daily[1]["subtype"], "")

print("\n--- events ---")
check("nameless conversion row dropped", len(events), 1)
check("action name preserved verbatim", events[0]["action"].endswith("receipt_paid"), True)
check("category uppercased", events[0]["category"], "PURCHASE")
check("event conversions", events[0]["conversions"], 120.0)

print("\n--- campaigns ---")
check("campaign count", len(campaigns), 1)
check("budget micros converted", campaigns[0]["dailyBudget"], 50.0)
check("bid strategy mapped", campaigns[0]["bidStrategy"], "TARGET_SPEND")

print("\n--- plumbing ---")
check("currency detected from customer", currency, "USD")
check("three queries issued", len(calls), 3)
check("customer id stripped to digits", bad._digits("123-456-7890"), "1234567890")
check("auth description names the version", bad.ADS_API_VERSION in desc, True)
check("auth description names the MCC", "999888777" in desc.replace("7777", "777"), True)
check("api_configured() true with all vars set", bad.api_configured(), True)
check("resolve_source() picks api", bad.resolve_source(), "api")

# Cross-check: the daily rows must sum to the same cost the metrics imply.
total = sum(r["cost"] for r in daily)
check("cost sums to 416.565 (416565000 micros)", round(total, 6), 416.565)

# And the guard that matters: an unset var must be caught, not half-run.
del os.environ["GOOGLE_ADS_REFRESH_TOKEN"]
check("api_configured() false once a var is removed", bad.api_configured(), False)
check("api_missing() names it", bad.api_missing(), ["GOOGLE_ADS_REFRESH_TOKEN"])
try:
    bad.ADS_SOURCE = "api"
    bad.resolve_source()
    check("ADS_SOURCE=api with missing vars raises", False, True)
except RuntimeError as err:
    check("ADS_SOURCE=api with missing vars raises", "GOOGLE_ADS_REFRESH_TOKEN" in str(err), True)

print(f"\n{len(fails)} failure(s)" + ("" if not fails else ": " + ", ".join(fails)))
sys.exit(1 if fails else 0)
