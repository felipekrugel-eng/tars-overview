# merchant-base-automation-pr

Puerto Rico twin of `merchant-base-automation`. Built 28 Sep 2026.

Same pipeline, three differences:
1. `queries/q1_base.sql` filters `LOYVERSE_MERCHANTS.COUNTRY = 'PR'`. Stripe connected accounts
   are read with `COUNTRY IN ('US','PR')` because Stripe files Puerto Rico under US (STATE = 'PR').
2. Name-only Stripe links additionally require the Stripe address state to be PR. On the first pull
   8 generic names ('Legacy', 'The Shop', 'Grocery store'...) matched US accounts, two with MO/TX
   addresses. Email-exact links are unaffected (17 of 17 on 28 Sep).
3. `build_full_base.py` fills the funnel "Expected" column from the pull itself - there is no PR
   dashboard to reconcile against yet. Read Me text is PR-specific.

Run:  python3 build_full_base.py data/q1_export.csv PR_Merchant_Base_FULL.xlsx
      python3 merchant_base_model.py --workbook PR_Merchant_Base_FULL.xlsx
      soffice --headless --convert-to xlsx --outdir _recalc PR_Merchant_Base_FULL.xlsx

## GitHub Actions

`.github/workflows/merchant-base-pr-pull.yml` runs `run.py` daily at 05:10 UTC (and on
`workflow_dispatch`). It commits `data/q1_export.csv.gz` and
`output/PR_Merchant_Base_FULL.xlsx` back to master, so the latest workbook is always at
`merchant-base-automation-pr/output/PR_Merchant_Base_FULL.xlsx` on GitHub.
Margin Assumptions inputs and hand-typed ACTION text are carried forward from the
previously published workbook, same as the US pipeline.
