# merchant-base-automation-eu

One pipeline, four markets: **Spain (ES), Switzerland (CH), Belgium (BE), Netherlands (NL)**.
Built 15 Oct 2026 from the PH pipeline, which was built from the PR one, which was built from the US one.
Same query, same 13 tabs, same 94-column layout as `US_Merchant_Base_FULL.xlsx`, so a column means the
same thing in every market file.

## Where the files are

Latest build on GitHub master (download, no login — the repo is public):

| Market | Workbook |
|---|---|
| Spain | https://github.com/felipekrugel-eng/tars-overview/raw/master/merchant-base-automation-eu/output/ES_Merchant_Base_FULL.xlsx |
| Switzerland | https://github.com/felipekrugel-eng/tars-overview/raw/master/merchant-base-automation-eu/output/CH_Merchant_Base_FULL.xlsx |
| Belgium | https://github.com/felipekrugel-eng/tars-overview/raw/master/merchant-base-automation-eu/output/BE_Merchant_Base_FULL.xlsx |
| Netherlands | https://github.com/felipekrugel-eng/tars-overview/raw/master/merchant-base-automation-eu/output/NL_Merchant_Base_FULL.xlsx |

(US: `merchant-base-automation/output/US_Merchant_Base_FULL.xlsx` · PR: `merchant-base-automation-pr/output/PR_Merchant_Base_FULL.xlsx`.)

## How a market is selected

`COUNTRY=<CC>` (ES/CH/BE/NL). `countries.py` holds the market list: name, till currency, and the
pull sanity gate (MIN_ROWS). `queries/q1_base.sql.tmpl` is the ONE query; `run.py` renders
`queries/q1_base_<CC>.sql` from it every run (the rendered files are committed for reading, never
hand-edited). Adding a market = one line in `countries.py` + one entry in the workflow matrix.

Differences from the US query, all in the template:
1. `LOYVERSE_MERCHANTS.COUNTRY = '<CC>'` everywhere (base, bot screen, email/name link tables).
2. Receipts filtered on the market's currency (`EUR` / `CHF`) and converted to USD at the **latest
   daily rate in `LOYVERSE_DATA_LAKE.PUBLIC.CURRENCY_RATES`** (USD-based, refreshed daily) in the `fx`
   CTE. Every `_USD` column is in dollars; `GTV_UNIT_SCALE` on every row = the USD-per-local factor
   used, and the Read Me tab states the rate. Bands, thresholds and the margin model keep their US meaning.
3. The dollars-vs-cents unit probe runs in USD-equivalent terms.
4. Stripe connected accounts filtered on `COUNTRY = '<CC>'`; Stripe charges in the local currency,
   converted the same way. Until Loyverse Payments is live in a market the payments columns are
   empty/zero by construction (NL has 1 connected account on 15 Oct 2026; the others 0).
5. `BASE_GROUP = 'new'` keeps 2026-07-01 (the US launch) as a reference date only.
6. `MAXROW` is 1,000,000 in both scripts (inherited from PH).

Run locally:

    COUNTRY=ES python3 run.py            # pull -> build -> model -> recalc -> verify -> publish
    # or step by step
    COUNTRY=ES python3 build_full_base.py data/ES/q1_export.csv ES_Merchant_Base_FULL.xlsx
    COUNTRY=ES python3 merchant_base_model.py --workbook ES_Merchant_Base_FULL.xlsx
    soffice --headless --convert-to xlsx --outdir _recalc ES_Merchant_Base_FULL.xlsx

## GitHub Actions

`.github/workflows/merchant-base-eu-pull.yml` runs `run.py` for each market in sequence daily at
05:40 UTC (and on `workflow_dispatch`, with an optional `country` input), committing
`data/<CC>/q1_export.csv.gz`, `output/<CC>_Merchant_Base_FULL.xlsx` and the rendered query back to
master. Margin Assumptions inputs and hand-typed ACTION text are carried forward from the previously
published workbook, same as the US pipeline.

## Building inside the Cowork sandbox

`run.py` works where LibreOffice and a few GB of RAM are available (GitHub Actions). In the Cowork
sandbox (3 GB, ~3-minute calls) use `build_sandbox.py` (prep → chunk → assemble, see its docstring),
which writes the identical workbook with fullCalcOnLoad so Excel computes the formulas on first open.
The 15 Oct 2026 first builds were made that way.
