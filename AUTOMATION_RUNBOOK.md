# Runbook — getting both workbooks live

Do these in order. Total hands-on time ~30 min, plus however long the Snowflake grant
takes to get approved.

**One change to the order I gave you earlier.** The Snowflake grant is now **step 1**,
not step 2. `margin-pull` works without it (it reads the CSVs `payments-pull` already
commits), but `merchant-base-pull` has no committed CSV to fall back to on its first
run — if the pull fails, `run.py` exits with "no CSV" and the job fails. So the grant
has to land before the merchant base can complete even once.

---

## Step 1 — Get the Snowflake grant

This is the blocker for everything and the only step you can't do yourself unless you
hold `ACCOUNTADMIN`.

Ask whoever administers the Snowflake account to run:

```sql
USE ROLE ACCOUNTADMIN;

GRANT IMPORTED PRIVILEGES
  ON DATABASE GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659
  TO ROLE DATA_VIEWER;
```

Then verify as `TARS_SERVICE_USER` / `DATA_VIEWER`:

```sql
USE ROLE DATA_VIEWER;
SELECT COUNT(*)
FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNTS;
```

A row count means done. An "object does not exist or not authorized" error means the
grant hasn't taken.

**Why it matters:** this is the OPEN ITEM already documented in `payments-pull.yml`.
Until it lands, that pipeline has been failing its <100-row sanity gate and rebuilding
from last-good CSVs — so the payments workbooks have been refreshing on schedule
without refreshing their data. Fixing this one grant improves three pipelines, not
two.

---

## Step 2 — Push to `tars-overview`

### 2a. Start from a clean clone

You have three clones on the Desktop and **none is safe to push from**: newest is
`tars-overview-fresh` at Aug 12 with 21 uncommitted files. Clone fresh:

```bash
cd ~/Desktop
git clone https://github.com/felipekrugel-eng/tars-overview.git tars-overview-live
cd tars-overview-live
git log -1 --format='%ci %s'      # confirm you're at current master
```

> **Security, unrelated but do it today:** `Desktop/Loyverse/Output Claude/tars-repo`
> has a GitHub personal access token in plaintext in its git remote URL. Rotate that
> token (GitHub → Settings → Developer settings → Personal access tokens) and delete
> the clone. Anything that reads that folder can read the credential.

### 2b. Copy in only what belongs in the repo

Roughly 11 MB, not the 127 MB sitting in `Desktop/Automation/`. The big files there
are local test artefacts.

```bash
SRC=~/Desktop/Automation
DST=~/Desktop/tars-overview-live

# workflows
mkdir -p "$DST/.github/workflows"
cp "$SRC/.github/workflows/margin-pull.yml"         "$DST/.github/workflows/"
cp "$SRC/.github/workflows/merchant-base-pull.yml"  "$DST/.github/workflows/"

# margin-automation: code + the template (the template IS the deliverable)
mkdir -p "$DST/margin-automation/tools" "$DST/margin-automation/template"
cp "$SRC/margin-automation/refresh_margin_workbook.py" "$DST/margin-automation/"
cp "$SRC/margin-automation/run.py"                     "$DST/margin-automation/"
cp "$SRC/margin-automation/requirements.txt"           "$DST/margin-automation/"
cp "$SRC/margin-automation/tools/make_margin_template.py" "$DST/margin-automation/tools/"
cp "$SRC/margin-automation/template/"*.xlsx            "$DST/margin-automation/template/"

# merchant-base-automation: code + queries + the ACTION seed
mkdir -p "$DST/merchant-base-automation/queries" "$DST/merchant-base-automation/data"
cp "$SRC/merchant-base-automation/"*.py                "$DST/merchant-base-automation/"
cp "$SRC/merchant-base-automation/requirements.txt"    "$DST/merchant-base-automation/"
cp "$SRC/merchant-base-automation/queries/"*           "$DST/merchant-base-automation/queries/"
cp "$SRC/merchant-base-automation/data/action_seed.csv" "$DST/merchant-base-automation/data/"
cp "$SRC/merchant-base-automation/data/README.md"       "$DST/merchant-base-automation/data/"

cp "$SRC/README.md" "$DST/AUTOMATION_README.md"
cat "$SRC/.gitignore" >> "$DST/.gitignore"
```

### What you are deliberately NOT copying, and why

| Skipped | Size | Why |
|---|---|---|
| `margin-automation/data/*.csv` | ~32 MB | My local copies of `payments-automation/data/`. The workflow reads the real ones from that folder. |
| `margin-automation/output/*.xlsx` | 14 MB | Built from the Aug 12 CSVs — **older than your current workbook**. The first run replaces it. |
| `merchant-base-automation/data/q1_export.FIXTURE*.csv` | 30 MB | Test fixture, not a Snowflake export. Delete it locally once a real pull has run. |
| `merchant-base-automation/output/*.xlsx` | 20 MB | Fixture-built. Proves the shape, not a deliverable. |

Skipping the two `output/` files is correct, not a shortcut: with no previous
workbook, `Margin Assumptions` uses the defaults I transcribed from your Aug 21 file
(same values), and `ACTION` comes from `action_seed.csv`. From run two onward the
published workbook takes over.

### 2c. Commit and push

```bash
cd ~/Desktop/tars-overview-live
git add .github/workflows/margin-pull.yml \
        .github/workflows/merchant-base-pull.yml \
        margin-automation merchant-base-automation \
        AUTOMATION_README.md .gitignore
git status                                    # sanity-check the list before committing
git commit -m "feat(workbooks): server-side rebuild for margin + merchant base"
git push
```

`git status` before committing is the one step not to skip — confirm no `.csv` over a
few MB and no `output/*.xlsx` crept in.

---

## Step 3 — First run, manually

Both workflows have `workflow_dispatch`, so you can trigger them without waiting for
the schedule.

### 3a. Margin (safe to run first — no Snowflake dependency)

GitHub → **Actions** → **margin-pull** → **Run workflow** → branch `master` → Run.

Watch the "Rebuild → recalc → verify → publish" step. Success looks like:

```
VERIFY: sheets=12 rows=16,089 volume=$… revenue=$… cost=$… (2.4xx% of volume) …
VERIFY OK
published …/Loyverse_Payments_Transaction_Margin_vs_Competitors.xlsx (13.8 MB)
```

The number to check is **cost as % of volume — it must be ~2.5%**. That gate is there
because the identities (`margin = revenue − cost`) hold at any scale and cannot catch
a cents/dollars error; the ratio can.

### 3b. Merchant base (needs step 1 done)

GitHub → **Actions** → **merchant-base-pull** → **Run workflow**.

Success looks like:

```
pulled 131,2xx rows
Full Base: 131,2xx data rows, 6x generated columns
model columns appended: ~350,000 formula cells over 131,2xx rows
ACTION baseline: 8 seeded + 0 carried = 8 expected to survive
VERIFY: rows=131,2xx action_entries=8 sheets=13
VERIFY OK
```

Check `action_entries=8`. If it's lower, your hand-typed follow-ups didn't survive and
verify should already have failed the run.

### If verify fails

Nothing is published — the previous file stays put. Download the
`*-build-debug` artifact from the run summary; it contains the exact `_build.xlsx` and
the LibreOffice recalc output so you can open the offending file. The failure reason is
printed as a `- ` list at the end of the log.

---

## Step 4 — Decide where you read from

The workflows commit into the repo. Nothing lands on your Desktop yet. Three options:

| Option | Good for | Cost |
|---|---|---|
| **A. Read the committed file** | Simplest. Open from `tars-overview-live` after a `git pull`. | You have to remember to pull. |
| **B. Desktop mirror** | Opening the file where you already look for it. | Needs a small local scheduled task; the lock-file and atomic-replace guards are already written. |
| **C. Dashboard** | The genuinely "live" view — the pattern your other pipelines already use (`margins-data.js` → Netlify). | A bit more work; best answer for anyone who isn't you. |

**Before you choose B, one thing to be clear about.** A mirror would overwrite your
current workbook, and **only two things you type survive a rebuild**: the blue
`Margin Assumptions` inputs, and `ACTION`. Any other hand-added column, tab or note is
gone on the next run. If there's anything in either file you haven't told me about,
say so before turning the mirror on.

Tell me which option and I'll wire it — for B I need to know whether it should
overwrite `Desktop/Spreadsheets/…` or land somewhere new.

---

## Quick reference

| | Margin | Merchant base |
|---|---|---|
| Workflow | `margin-pull` | `merchant-base-pull` |
| Cadence | on `payments-pull` completing (~every 3h) | daily 04:40 UTC |
| Needs the grant? | no | **yes** |
| Snowflake cost | none (reuses existing CSVs) | one `q1` run/day |
| Output | `margin-automation/output/` | `merchant-base-automation/output/` |
| Runtime | ~2 min | ~10–25 min |
