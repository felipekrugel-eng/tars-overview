# bot-filter

The registration bot-screen: the shared SQL exclusion set, the tooling that keeps it
consistent across the 14 reference queries, and the daily all-country anomaly alert.

## The exclusion set

`bot_accounts` is the union of three CTEs, spliced byte-identically into all 14 reference
SQL files. Every reference site reads the union, never one part.

| CTE | Scope | Rules |
|---|---|---|
| `us_bot_accounts` | `COUNTRY = 'US'`, all-time | S1–S6 per-account name signatures, S7/S8 name clusters |
| `global_bot_accounts` | country-agnostic, from 2026-03-01 | G1 own-domain, G2 scripted burst, G3 brand-on-brand-domain, G4 homoglyph evasion |
| `shape_bot_accounts` | country-agnostic, from 2026-03-01 | N1 novel name-shape burst |

Every rule carries an **independent second factor**. That is not stylistic. The first draft
of the September rule, before its FP sweep, flagged PH "Sabunan Point" (13,850 receipts,
$46,734), PH "KUAN UA" (7,087 receipts), ID "DELIMA", MY "KONSORTIUM SAJIAN SERI PERAK" and
PH "EXPO2026" — a real 31-person event cohort who signed up minutes apart. Any single-signal
rule over `LOYVERSE_MERCHANTS` will flag staff-onboarded merchant batches and genuine event
cohorts. Mailbox randomness in particular is never a selector (47% false-positive rate, July
2026); it may only confirm a set that is already suspicious on other grounds.

### Why N1 is keyed to name *shape*

One operator has run four waves, beating a rule generation each time by varying exactly one
attribute of the business name:

| Wave | Accounts | Name form | Caught by |
|---|---|---|---|
| 30–31 Jul 2026 | 8,001 | `Sale#<hex>` | S1 |
| 10–16 Sep 2026 | 1,834 | `Sale#<hex>` | S1 |
| 8 Oct 2026 | 78 | `1209534143`, repeated | S7/S8 |
| 8–12 Oct 2026 | 819 | unique 8-digit | **nothing** |

The fourth wave gave every account a distinct name, which kills every cluster rule, and used
human-plausible persona mailboxes (`michellejohnsonw795@gmail.com`), which kills
`random_local` — only 10.6% of the 819 match it. A rule keyed to "8 digits" would be obsolete
the moment they moved to 9. N1 therefore folds the name to a *shape* (digits→`9`,
lowercase→`a`, uppercase→`A`, length preserved) and asks whether a shape that is **new for
that country** suddenly arrives in bulk. Nine digits, twelve digits or random letters are all
simply different novel shapes.

### What N1 does not catch

Stated plainly, because the daily screen exists to cover these:

- **A shape that already has history in that country.** Eight-letter capitalised words
  (`Aaaaaaaa`) have a real baseline everywhere, so the novelty test blocks them. This is the
  obvious next move for the operator and N1 will not see it.
- **Anything below 20 in a country-day.** The 819th account of the October wave registered
  alone at 23:58 on 8 Oct and is correctly not flagged. Recall is 818/819.
- **A wave spread thinly** across many countries, or across a day at 19 per country.
- **Mailboxes with dots inserted**, or spread across non-freemail domains.

## Keeping the block identical

```
python3 bot-filter/verify_cte.py      # all 14 files carry one byte-identical block
node   bot-filter/verify_sql.js       # all 14 compile (EXPLAIN USING TEXT)
```

`verify_sql.js` expands the pull-time tokens first. `/*MERCHANT_IDS*/`, `/*PILOT_IDS*/`,
`/*ACCOUNT_IDS*/` and `/*RECENT_FROM*/` are bare placeholders and must be filled or the
verifier reports false compile failures. `/*COUNTRY*/`, `/*LAUNCH*/`, `/*FIRST_MONTH*/` and
`/*MARKETS*/` are **not** bare — the pipeline rewrites a default that is already valid SQL,
so they compile untouched.

## The daily screen

`daily_bot_screen.js` compares each country-day's registrations against a rolling median of
the previous 28 days, **lagged by 2 days** so a wave that has been running cannot raise its
own baseline. A country-day is flagged at ≥20 registrations, ≥1.5× the median, and ≥4 scaled
MAD above it. Each flag is characterised — distinct-name ratio, top name-shape share, mailbox
shape, receipts and GTV — and labelled by how much of the *excess over baseline* the deployed
filter already excludes.

It posts to Slack only when something is not already handled; a clean run stays silent,
because an alert that fires every day stops being read. Expect roughly one or two flags a
week, most of them dismissible in seconds from the characterisation line.

**This does not replace the CloudWatch alarm, and the alarm does not replace this.** The
CloudWatch alarm is a *rate* test at 250 per 15 minutes. The October wave peaked at **34 per
15 minutes** — seven times under the threshold — while delivering 388 accounts in a day. A
volume-versus-baseline test is the shape these waves actually have.

### Setup

Requires `SNOWFLAKE_PRIVATE_KEY` (already present) and **`SLACK_WEBHOOK_URL`, which does not
exist yet** — add it under Settings → Secrets → Actions. Until it does, the job runs and
logs but cannot post. Existing alerting in this repo is Telegram
(`TELEGRAM_BOT_TOKEN`); if Slack is not wanted, the `fetch` at the end of
`daily_bot_screen.js` is the only thing that needs changing.

Run it by hand with:

```
SNOWFLAKE_KEY_PATH=/path/to/snowflake_tars_key.p8 LOOKBACK_DAYS=5 DRY_RUN=1 \
  node bot-filter/daily_bot_screen.js
```
