"""Markets served by merchant-base-automation-eu. One pipeline, one folder, one workbook per
country: output/<CC>_Merchant_Base_FULL.xlsx. Add a market = add a line here.

MIN_ROWS is the pull sanity gate (fewer rows than this = bad pull, keep the last good CSV);
set at roughly 80% of the base measured on 15 Oct 2026."""
COUNTRIES = {
    "ES": dict(name="Spain",       currency="EUR", min_rows=80_000),   # 103,208 raw merchants, 15 Oct 2026
    "CH": dict(name="Switzerland", currency="CHF", min_rows=11_000),   # 14,367
    "BE": dict(name="Belgium",     currency="EUR", min_rows=16_000),   # 20,528
    "NL": dict(name="Netherlands", currency="EUR", min_rows=13_000),   # 16,899
}

def render_sql(cc, template_path, out_path):
    cfg = COUNTRIES[cc]
    sql = open(template_path, encoding="utf-8").read()
    sql = (sql.replace("{{COUNTRY_NAME}}", cfg["name"])
              .replace("{{COUNTRY}}", cc)
              .replace("{{CURRENCY}}", cfg["currency"]))
    open(out_path, "w", encoding="utf-8").write(sql)
    return sql
