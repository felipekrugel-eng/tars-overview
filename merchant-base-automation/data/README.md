# data/

`q1_export.csv` — written by `run.py` from `queries/q1_base.sql`. Committed each run
so a failed pull can fall back to the last good extract.

`q1_export.FIXTURE_90757rows.csv` — **a test fixture, not a Snowflake export.**
Extracted from the 21 Aug workbook's `Full Base` to prove the pipeline end to end
without Snowflake access. It is the dormant tail of the base (90,757 of 131,246 rows;
the full extract exhausted memory), so `Prime Base` and `Transacting Merchants` build
empty from it. Delete it once a real pull has run.

`action_seed.csv` — the eight hand-typed `ACTION` entries recovered from the 21 Aug
workbook. `ACTION` is not in the SQL (Q1's SELECT ends at `PULLED_AT`), and the first
automated run has no previous workbook to merge from, so without this those entries
would be lost on run one. After the first successful run the published workbook takes
over and this is only a backstop.
