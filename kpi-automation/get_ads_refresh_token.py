#!/usr/bin/env python3
"""
get_ads_refresh_token.py — mint the GOOGLE_ADS_REFRESH_TOKEN secret, once.

Run this ON YOUR OWN MACHINE, not in CI. It opens a browser, you approve access
as the Google account that can see the Ads account, and it prints a refresh
token to paste into GitHub secrets. Nothing is written to disk and nothing
leaves your machine except the standard OAuth exchange with Google.

    python3 kpi-automation/get_ads_refresh_token.py

You need the OAuth client id and secret first (Google Cloud Console ->
APIs & Services -> Credentials -> Create credentials -> OAuth client ID ->
application type "Desktop app"). See "Marketing Tab — Google Ads API Setup.md".

Stdlib only, so there is nothing to install.
"""

from __future__ import annotations

import http.server
import json
import secrets
import socket
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
SCOPE = "https://www.googleapis.com/auth/adwords"

_result: dict[str, str] = {}


class _Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 (stdlib naming)
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        _result.update({k: v[0] for k, v in query.items()})
        ok = "code" in _result
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        body = (
            "<h2>Done — you can close this tab.</h2>"
            if ok
            else f"<h2>Authorisation failed</h2><p>{_result.get('error','no code returned')}</p>"
        )
        self.write_quietly(f"<html><body style='font-family:sans-serif'>{body}</body></html>")

    def write_quietly(self, text: str):
        try:
            self.wfile.write(text.encode())
        except BrokenPipeError:
            pass

    def log_message(self, *args):  # keep the console clean
        pass


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def main() -> int:
    print("Paste the OAuth credentials from the Google Cloud Console.")
    print('Application type must be "Desktop app" — a Web client will reject the')
    print("loopback redirect this script uses.\n")
    client_id = input("  client id     : ").strip()
    client_secret = input("  client secret : ").strip()
    if not client_id or not client_secret:
        print("\nBoth are required. Nothing done.")
        return 1

    port = _free_port()
    redirect_uri = f"http://localhost:{port}"
    state = secrets.token_urlsafe(16)

    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": SCOPE,
        # offline + consent together are what actually produce a refresh token.
        # Without prompt=consent Google returns only an access token on any
        # repeat authorisation, which is the single most common reason this step
        # appears to work and then yields nothing usable.
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    auth_url = f"{AUTH_URL}?{urllib.parse.urlencode(params)}"

    server = http.server.HTTPServer(("127.0.0.1", port), _Handler)
    threading.Thread(target=server.handle_request, daemon=True).start()

    print(f"\nListening on {redirect_uri}")
    print("Opening the browser. Approve access as the Google account that can")
    print("see the Ads account you want to report on.\n")
    print(f"If nothing opens, paste this in yourself:\n\n{auth_url}\n")
    try:
        webbrowser.open(auth_url)
    except Exception:
        pass

    print("Waiting for the redirect...")
    server_thread_timeout = 300
    for _ in range(server_thread_timeout * 10):
        if _result:
            break
        threading.Event().wait(0.1)
    server.server_close()

    if "code" not in _result:
        print(f"\nNo authorisation code came back: {_result.get('error', 'timed out')}")
        return 1
    if _result.get("state") != state:
        print("\nState mismatch — discarding the response rather than trusting it.")
        return 1

    payload = urllib.parse.urlencode(
        {
            "code": _result["code"],
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }
    ).encode()
    req = urllib.request.Request(
        TOKEN_URL, data=payload, headers={"Content-Type": "application/x-www-form-urlencoded"}
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            tokens = json.loads(resp.read().decode())
    except urllib.error.HTTPError as err:
        print(f"\nToken exchange failed: {err.read().decode(errors='replace')[:400]}")
        return 1

    refresh = tokens.get("refresh_token")
    if not refresh:
        print(
            "\nGoogle returned no refresh_token. This happens when the account has "
            "already granted this client and Google reuses the old grant. Revoke it "
            "at https://myaccount.google.com/permissions and run this again."
        )
        return 1

    print("\n" + "=" * 68)
    print("Add these as GitHub repository secrets (Settings -> Secrets and")
    print("variables -> Actions). Do not commit them.")
    print("=" * 68)
    print(f"\nGOOGLE_ADS_CLIENT_ID\n  {client_id}")
    print(f"\nGOOGLE_ADS_CLIENT_SECRET\n  {client_secret}")
    print(f"\nGOOGLE_ADS_REFRESH_TOKEN\n  {refresh}")
    print(
        "\nStill needed: GOOGLE_ADS_DEVELOPER_TOKEN (from the MCC's API Center),\n"
        "GOOGLE_ADS_CUSTOMER_ID (the account running the campaigns) and\n"
        "GOOGLE_ADS_LOGIN_CUSTOMER_ID (the MCC).\n"
    )
    print(
        "One caveat worth knowing now: if the OAuth consent screen is still in\n"
        '"Testing" mode, this refresh token stops working in 7 days. Publish the\n'
        "app, or set the user type to Internal, before relying on it.\n"
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nCancelled.")
        sys.exit(130)
