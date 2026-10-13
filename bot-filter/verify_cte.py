#!/usr/bin/env python3
"""Assert the bot-filter CTE block is byte-identical across all 14 reference SQL files."""
import hashlib, pathlib, sys

REPO = pathlib.Path(__file__).resolve().parent.parent
FILES = [
 'activated-payments/sql/us_bases.sql','activated-payments/sql/us_bases_monthly.sql',
 'activated-payments/sql/us_group_tags.sql','activated-payments/sql/us_registrations.sql',
 'kpi-automation/sql/cohort_country_snapshot.sql','kpi-automation/sql/cohort_unit_economics_daily_asof.sql',
 'kpi-automation/sql/country_month_registrations_daily_asof.sql','kpi-automation/sql/country_registrations_daily_asof.sql',
 'kpi-automation/sql/cusum_hourly_registrations.sql','kpi-automation/sql/cusum_today_reconstruct.sql',
 'kpi-automation/sql/receipts_tpv_daily_asof.sql','kpi-automation/sql/rolling_30d_active_paying_49days.sql',
 'kpi-automation/sql/rolling_30d_by_country_49days.sql','merchant-base-automation/queries/q1_base.sql']

def block(s):
    i = s.find('us_bot_accounts AS (')
    if i < 0: return None
    g = s.find('SELECT LOYVERSE_ID FROM shape_bot_accounts')
    if g < 0: return None
    return s[i:s.find(')', g) + 1]

hashes, missing = {}, []
for rel in FILES:
    s = (REPO / rel).read_text(encoding='utf-8')
    b = block(s)
    if b is None: missing.append(rel); continue
    hashes.setdefault(hashlib.sha1(b.encode()).hexdigest()[:10], []).append(rel)

for h, fs in sorted(hashes.items(), key=lambda kv: -len(kv[1])):
    print(f"{h}  {len(fs):2d} files")
    if len(hashes) > 1:
        for f in fs: print(f"      {f}")
for m in missing: print(f"MISSING   {m}")

if missing or len(hashes) != 1:
    print(f"\nFAIL: {len(hashes)} distinct block(s), {len(missing)} missing"); sys.exit(1)
print(f"\nOK: one block across all {len(FILES)} files")
