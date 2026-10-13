# Registration restatement — October 2026 US bot wave

**Date:** 2026-10-12 · **Owner:** Felipe · **Source:** `LOYVERSE_MERCHANTS`, `LOYVERSE_RECEIPTS`,
Snowflake `TARS_SERVICE_USER` / `DATA_VIEWER`

## What happened

819 accounts registered in the US between 2026-10-08 23:58 and 2026-10-12, each with a
business name that is 8 uniformly random digits. The numbers are machine-drawn: uniform over
10,000,000–99,999,999 (mean 55,464,520 against a theoretical 55,000,000), first-digit counts
73–105 against an expected 91, and **zero collisions in 818 draws**. 818 of the 849 accounts
in Loyverse's entire history with an 8-digit numeric name arrived in these four days; the
prior rate was roughly one a quarter.

Every one of them passed the deployed filter. All nine per-account rules (S1–S6, S2b, G1, G3)
fire on 0 of 819, and the three cluster rules (S7, S8, G2) cannot fire because all 819 names
are distinct. The mailboxes are human-plausible personas — `michellejohnsonw795@gmail.com`,
`dorothyevansk051@gmail.com` — unrelated to the business name; only 10.6% match
`random_local`. This is shaped to defeat the September rule specifically.

**This is the fourth wave from one operator**, each beating the rule generation that caught
the last:

| Wave | Accounts | Name form | Caught by the deployed filter |
|---|---|---|---|
| 30–31 Jul 2026 | 8,001 | `Sale#<hex>` | 7,999 (100%) |
| 10–16 Sep 2026 | 1,834 | `Sale#<hex>` | 1,834 (100%) |
| 8 Oct 2026 | 78 | `1209534143`, repeated | 78 (100%) |
| **8–12 Oct 2026** | **819** | unique 8-digit | **0** |

The 8 Oct batch is the tell: they tried a repeated name, S7/S8 caught all 78 within a day, and
they switched to unique names. The iteration cycle is roughly 24 hours.

## The part that differs from September

**These accounts transact.** September's wave never produced a receipt, so TPV, receipts,
active-paying and cohort revenue were all untouched and the correction only removed inflated
denominators. That does not hold this time.

`RECEIPTS_LIFETIME` and `POS_RECEIPTS_12M` are zero for all 819, but those come from the
lagging monthly rollup and are zero for the 278 organic accounts registered in the same
window too — they prove nothing. The raw receipts table disagrees:

| | |
|---|---|
| merchants with receipts | **352** of 819 |
| receipt rows | **58,536** |
| POS GTV | **$5,359,819** |
| first → last receipt | 2026-10-09 00:17 PT → still running at time of writing |
| cancelled | 0 |

The receipts are synthetic. Every one carries `SOURCE = 'token1'`, no `POS_DEVICE_ID`, no tax,
no tip, no discount, no note, exactly one store and one employee per merchant, and 100%
`NONINTEGRATEDCARD` payments with null card company and null entry method. Accounts registered
on 10 Oct booked 850–950 receipts inside a day on median tickets of exactly $30.00, $35.00,
$49.99 and $40.00. Genuine new US signups in the same window run a median of 2 receipts and
$61; this cohort runs a median of 76 receipts and $6,980.

Two caveats on reading `token1` as a bot signal — it is not one. `token1` is a shared
integration label used by 3,337 US merchants since 29 July, and the extreme receipt shape
(0% device, 0% tax, 0% tip) is identical for legitimate `token1` merchants. Neither is used
as a selector anywhere in the filter.

**Payments is clean.** Zero Stripe accounts, $0 processed volume, zero subscriptions, zero
Chargebee customers across all 819. No money moved. Processed-payment TPV and MRR need no
correction.

## Restatement

### US daily registrations

| Date | Published | Restated | Δ |
|---|---|---|---|
| 1–7 Oct | unchanged | unchanged | 0 |
| 8 Oct | 70 | 70 | 0 |
| 9 Oct | 167 | 84 | −83 |
| 10 Oct | 327 | 72 | −255 |
| 11 Oct | 231 | 84 | −147 |
| 12 Oct (partial) | 388 | 54 | −334 |

Baseline for 1 Sep – 8 Oct is 65.4 ± 8.6 per day (median 65, max 86), so the restated
residual sits at or just above baseline on every day. 100% of the excess was this cohort.

8 Oct stays at 70 and still contains one bot — account 5308420, which registered alone at
23:58 and is below any burst threshold. It is a known, accepted miss.

### Other countries

| Country | Date | Published | Restated |
|---|---|---|---|
| SE | 13 Sep | 20 | 19 |
| AL | 13 Sep | 6 | 5 |

These are the homoglyph rule (G4) picking up two `Vlnted` accounts that evaded S2b in
September and were never counted as bots. No other country-day in any period changes.

### Activity and GTV — new this time

| Metric | Published | Restated | Δ |
|---|---|---|---|
| US 30-day active merchants | 5,188 | 4,836 | **−352 (−6.8%)** |
| US POS receipts, L30D | — | — | **−58,536** |
| US POS GTV, L30D | — | — | **−$5,359,819** |
| US Q4-2026 cohort denominator | 1,656 | 837 | **−819 (−49.5%)** |

The Q4 cohort denominator is the one to watch: as published, **half of the US Q4 2026 cohort
is this wave**. Any activation or conversion rate computed on it is currently meaningless.
As in September, removing the inflated denominator *improves* conversion and activation rates
— but unlike September it also removes real numerator rows, because 352 of these accounts
counted as active.

### Not affected

Processed payments TPV, Stripe volume, MRR, active-paying counts, Chargebee revenue, and
every country other than US, SE and AL.

## The filter change

| | |
|---|---|
| total flagged, all rules | 23,709 |
| previously flagged | 22,888 |
| **incremental** | **821** (818 from N1, 3 from G4) |
| recall against the 819 | 818 |
| flagged with ≥7 active receipt days | **0** |
| flagged with ≥30 active receipt days | **0** |
| flagged that are Chargebee customers | **0** |
| real-merchant FP query | **0 rows** |
| files compiling (`EXPLAIN USING TEXT`) | **14 / 14** |

N1 fires on eight burst groups in all of history. Five are this wave. The other three are
previously-known bot clusters that the deployed rules already catch: `P0SHMARK` (86, 10 Apr),
`PoshmarkSupp` (59, 5 Jun) and the 8 Oct `1209534143` batch.

## Open item: the registration endpoint

A filter is cleanup. Every wave caught downstream has already consumed the funnel, and this
one also consumed the activation and GTV metrics. What the endpoint would need:

1. **Email verification before the account is live.** All 819 are on gmail.com with an average
   local-part length of 15.1 and 423 of them in a `name+digits` pattern. Gating account
   creation on a confirmed mailbox is the single highest-value change.
2. **A business-name policy.** A name that is purely numeric, or purely a single machine
   character class, has no legitimate use and is the one attribute this operator has varied
   four times. Rejecting it at source is cheaper than detecting it four times downstream.
3. **Per-IP and per-subnet rate limiting.** Median inter-arrival across the wave was 13.5
   seconds, and 332 of 818 arrived within 5 seconds of the previous one.
4. **A bot challenge on the registration form.**
5. **Reject Loyverse's own `@loyverse.com` domain** — still open from September.

**The CloudWatch alarm cannot close this gap.** It is a rate test at 250 per 15 minutes. This
wave peaked at **34 per 15 minutes** — seven times under the threshold — while delivering 388
accounts in a day. It fired on 12 Oct for an unrelated Philippine burst that turned out to be
organic. A volume-versus-baseline test per country per day is the right shape, which is what
`bot-filter/daily_bot_screen.js` now does.

### What is still missing

The one piece of evidence this investigation could not obtain is **client IPs and user agents
for `/data/cabinetregistration` over 8–12 Oct**. CloudWatch Logs Insights IAM is denied for
that channel and New Relic carries no client IP. Without it we cannot say definitively whether
this is external abuse or something writing merchant records from inside.

What the data does say: all 819, and all 78 from the 8 Oct batch, carry the identical
attribution `utm_source=google-play&utm_medium=organic` with `INGESTION_SOURCE = 'live'`.
Against 2,382 US registrations with that referrer since ID 5,200,000, they are heavily
concentrated but not exclusive. That points to the Android app registration path, or a client
spoofing its attribution — it does not settle the question.
