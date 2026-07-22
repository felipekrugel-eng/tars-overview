#!/usr/bin/env python3
"""
FACADASH-pattern server-side orchestrator for the Embedded Payments true-cost workbook.

Single entrypoint the GitHub Action calls (mirrors kpi-automation/run.py). Does the
WHOLE refresh on the runner — no desktop, no manual steps:

  1. PULL     Snowflake -> data/transactions.csv + data/icplus_costs.csv
              (pull_payments.py; sanity-gated). Skippable with --no-pull for local
              testing against the committed seed CSVs.
  2. REBUILD  refresh_workbook.py rebuilds every sheet of the V2 workbook from the CSVs.
  3. RECALC   LibreOffice headless recalculates so Excel opens with live values.
  4. VERIFY   scan for GENUINE formula errors (excluding the intentional #N/A NA()
              sentinels in the filtered TPV/Cost% helper columns) and confirm all 13
              sheets + headline cells are populated. Any failure -> non-zero exit so
              the workflow does NOT commit a broken workbook.

On success the finished workbook is written to output/loyverse_payments_analysis_ful_V2.xlsx,
which the workflow commits to the repo. That committed file is the source of truth,
refreshed daily with zero dependence on anyone's computer.
"""
import os, sys, subprocess, shutil, pathlib, argparse, json, datetime
import openpyxl

HERE     = pathlib.Path(__file__).resolve().parent
DATA_DIR = pathlib.Path(os.environ.get("DATA_DIR", HERE / "data"))
TEMPLATE = pathlib.Path(os.environ.get("TEMPLATE",
                        HERE / "template" / "loyverse_payments_analysis_ful_V2.xlsx"))
OUT_DIR  = pathlib.Path(os.environ.get("OUT_DIR", HERE / "output"))
OUT_XLSX = OUT_DIR / "loyverse_payments_analysis_ful_V2.xlsx"
# The "Summary of Margins" dashboard page (activated-payments/index.html) reads this file.
# Committed by the workflow alongside the workbook; Netlify auto-deploys on push.
MARGINS_OUT = pathlib.Path(os.environ.get("MARGINS_OUT",
                           HERE.parent / "activated-payments" / "margins-data.js"))
BUILD_XLSX = HERE / "_build.xlsx"   # scratch (pre-recalc)

GENUINE_ERRS = {"#REF!", "#DIV/0!", "#VALUE!", "#NAME?", "#NULL!", "#NUM!"}
EXPECTED_SHEETS = 13
HEADLINE = ["C5", "C6", "C8", "C11", "C12", "C25"]


def sh(cmd, **kw):
    print("+", " ".join(str(c) for c in cmd), flush=True)
    subprocess.run(cmd, check=True, **kw)


def soffice_bin():
    for name in ("soffice", "libreoffice"):
        p = shutil.which(name)
        if p:
            return p
    for p in ("/usr/bin/soffice", "/usr/bin/libreoffice"):
        if os.path.exists(p):
            return p
    raise RuntimeError("LibreOffice (soffice) not found on PATH.")


def recalc(src, out_dir):
    """LibreOffice headless resave -> forces a full recalc and caches values."""
    out_dir.mkdir(parents=True, exist_ok=True)
    sh([soffice_bin(), "--headless", "--calc", "--convert-to", "xlsx",
        "--outdir", str(out_dir), str(src)])
    produced = out_dir / (src.stem + ".xlsx")
    if not produced.exists():
        raise RuntimeError(f"LibreOffice did not produce {produced}")
    return produced


def verify(path):
    # data_only=True gives the LibreOffice-cached VALUES; a second load with
    # data_only=False lets us print the offending FORMULA next to each error cell,
    # which is what actually pinpoints the root cause on the runner.
    wb = openpyxl.load_workbook(path, data_only=True)
    fwb = openpyxl.load_workbook(path, data_only=False)
    sheets = [ws.title for ws in wb.worksheets]
    genuine, na = 0, 0
    err_cells = []   # [(sheet, coord, err_value, formula)]
    for ws in wb.worksheets:
        fws = fwb[ws.title]
        for row in ws.iter_rows():
            for c in row:
                v = c.value
                if isinstance(v, str):
                    if v == "#N/A":
                        na += 1
                    elif v in GENUINE_ERRS:
                        genuine += 1
                        formula = fws[c.coordinate].value
                        err_cells.append((ws.title, c.coordinate, v, formula))
    problems = []
    if len(sheets) != EXPECTED_SHEETS:
        problems.append(f"sheet count {len(sheets)} != {EXPECTED_SHEETS} ({sheets})")
    if genuine:
        problems.append(f"{genuine} genuine formula errors")
        # Group by sheet+error-type so the log is scannable, then dump the first
        # ~40 concrete cells with their formulas.
        from collections import Counter
        by_sheet = Counter((s, e) for s, _, e, _ in err_cells)
        print("VERIFY: genuine error breakdown (sheet, type -> count):", flush=True)
        for (sheet, etype), n in sorted(by_sheet.items(), key=lambda x: -x[1]):
            print(f"    {sheet!r:28} {etype:8} x{n}", flush=True)
        print("VERIFY: first offending cells (sheet!cell = err  <- formula):", flush=True)
        for sheet, coord, ev, formula in err_cells[:40]:
            print(f"    {sheet}!{coord} = {ev}   <- {formula}", flush=True)
        if len(err_cells) > 40:
            print(f"    ... +{len(err_cells)-40} more", flush=True)
    s = wb["Summary"]
    blanks = [a for a in HEADLINE if s[a].value in (None, "")]
    if blanks:
        problems.append(f"blank headline cells: {blanks}")
    headline = {a: s[a].value for a in HEADLINE}
    print(f"VERIFY: sheets={len(sheets)} genuine_errors={genuine} "
          f"intentional_na={na} headline={headline}", flush=True)
    return problems


def _num(v):
    """Cell value -> float or None ('-' placeholder / blank -> None)."""
    if v in (None, "", "-", "\u2013"):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def emit_margins(xlsx_path, out_path):
    """Serialize the workbook's Summary sheet into margins-data.js for the dashboard's
    'Summary of Margins' page. The dashboard mirrors the Summary tab exactly, so we read
    label (col B) + value (col C) straight from the deterministic Summary layout."""
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    s = wb["Summary"]
    B = lambda r: s.cell(r, 2).value          # label column
    C = lambda r: s.cell(r, 3).value          # value column
    pair = lambda r: {"label": B(r), "value": _num(C(r))}

    data = {
        "updated": datetime.date.today().isoformat(),
        "title": B(2),
        "subtitle": B(3),
        "kpis": {
            "txns":        _num(C(5)),
            "tpv":         _num(C(6)),
            "avgTicket":   _num(C(7)),
            "revenue":     _num(C(8)),
            "takeRate":    _num(C(9)),
            "totalFees":   _num(C(11)),
            "netMargin":   _num(C(25)),
            "netTakeRate": _num(C(26)),
            "pctProfitable":    _num(C(29)),
            "profitableTxns":   _num(C(27)),
            "unprofitableTxns": _num(C(28)),
            "withActual":    _num(C(30)),
            "withEstimated": _num(C(31)),
            "failed":        _num(C(32)),
        },
        "fees": {
            "total": _num(C(11)),
            "network": {"label": B(12), "total": _num(C(12)),
                        "items": [pair(13), pair(14), pair(15)]},
            "stripe":  {"label": B(16), "total": _num(C(16)),
                        "items": [pair(17), pair(18)]},
        },
        # Extra per-payout / hardware fees (rows 19-24; some may be null).
        "extraFees": [pair(r) for r in range(19, 25)],
        "scenarios": {
            "headers": {"name": B(38), "revenue": C(38)},
            "rows": [{"name": B(r), "revenue": _num(C(r))} for r in range(39, 45)],
        },
        "notes": {
            "settlement": " ".join(x for x in (B(34), B(35)) if x),
            "scenario": B(45),
        },
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    js = ("// AUTO-GENERATED by payments-automation/run.py — do not edit by hand.\n"
          "// Mirrors the Summary tab of loyverse_payments_analysis_ful_V2.xlsx.\n"
          "window.MARGINS = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n")
    out_path.write_text(js, encoding="utf-8")
    print(f"OK -> {out_path}  (netMargin={data['kpis']['netMargin']}, "
          f"scenarios={len(data['scenarios']['rows'])})", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-pull", action="store_true",
                    help="skip the Snowflake pull; rebuild from the committed CSVs "
                         "(local testing only)")
    args = ap.parse_args()

    tx = DATA_DIR / "transactions.csv"
    ic = DATA_DIR / "icplus_costs.csv"

    # 1. PULL
    if args.no_pull:
        print("--no-pull: using committed CSVs as-is.")
    else:
        try:
            sh([sys.executable, str(HERE / "pull_payments.py")])
        except subprocess.CalledProcessError as e:
            if e.returncode == 2:
                print("Pull hit the sanity gate (grant likely pending) — "
                      "rebuilding from the last-good committed CSVs.", flush=True)
            else:
                raise

    if not tx.exists() or not ic.exists():
        print(f"ERROR: missing input CSVs ({tx}, {ic}).", file=sys.stderr)
        sys.exit(1)

    # 2. REBUILD
    sh([sys.executable, str(HERE / "refresh_workbook.py"),
        "--tx", str(tx), "--ic", str(ic),
        "--template", str(TEMPLATE), "--out", str(BUILD_XLSX)])

    # 3. RECALC
    recalced = recalc(BUILD_XLSX, HERE / "_recalc")

    # 4. VERIFY
    problems = verify(recalced)
    if problems:
        print("VERIFY FAILED: " + "; ".join(problems), file=sys.stderr)
        sys.exit(1)

    # publish
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(recalced, OUT_XLSX)
    print(f"OK -> {OUT_XLSX}")

    # emit the dashboard's "Summary of Margins" data file from the finished workbook
    emit_margins(OUT_XLSX, MARGINS_OUT)

    # tidy scratch (leave nothing to accidentally commit)
    for p in (BUILD_XLSX,):
        try: p.unlink()
        except FileNotFoundError: pass
    shutil.rmtree(HERE / "_recalc", ignore_errors=True)


if __name__ == "__main__":
    main()
