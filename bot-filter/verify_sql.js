#!/usr/bin/env node
/**
 * verify_sql.js — EXPLAIN USING TEXT every reference SQL file that carries the bot CTE.
 *
 * Pull-time tokens must be expanded or the verifier reports false compile failures.
 * Note that /*COUNTRY*\/, /*LAUNCH*\/, /*FIRST_MONTH*\/ and /*MARKETS*\/ are NOT bare
 * placeholders — the pipeline rewrites a default that is already valid SQL, so they
 * compile untouched. Only the bare id-list tokens need filling.
 */
const fs=require('fs'), path=require('path');
const crypto=require('crypto');
const snowflake=require('snowflake-sdk');
snowflake.configure({logLevel:'ERROR'});
const REPO=path.join(__dirname,'..');
const CFG={account:process.env.SNOWFLAKE_ACCOUNT||'ORXEAZX-TC97659',
  username:process.env.SNOWFLAKE_USER||'TARS_SERVICE_USER',
  warehouse:process.env.SNOWFLAKE_WAREHOUSE||'COMPUTE_WH',
  role:process.env.SNOWFLAKE_ROLE||'DATA_VIEWER',
  database:process.env.SNOWFLAKE_DATABASE||'LOYVERSE_DATA_LAKE',
  schema:process.env.SNOWFLAKE_SCHEMA||'PUBLIC'};
function privateKey(){
  const pem=process.env.SNOWFLAKE_PRIVATE_KEY
    ? process.env.SNOWFLAKE_PRIVATE_KEY.replace(/\\n/g,'\n')
    : fs.readFileSync(process.env.SNOWFLAKE_KEY_PATH,'utf8');
  return crypto.createPrivateKey({key:pem,format:'pem'}).export({type:'pkcs8',format:'pem'});
}
const conn=()=>snowflake.createConnection({...CFG,authenticator:'SNOWFLAKE_JWT',privateKey:privateKey()});
const connect=c=>new Promise((res,rej)=>c.connect((e,x)=>e?rej(e):res(x)));
const q=(c,sqlText)=>new Promise((res,rej)=>c.execute({sqlText,complete:(e,s,r)=>e?rej(e):res(r)}));
const FILES=['activated-payments/sql/us_bases.sql','activated-payments/sql/us_bases_monthly.sql',
'activated-payments/sql/us_group_tags.sql','activated-payments/sql/us_registrations.sql',
'kpi-automation/sql/cohort_country_snapshot.sql','kpi-automation/sql/cohort_unit_economics_daily_asof.sql',
'kpi-automation/sql/country_month_registrations_daily_asof.sql','kpi-automation/sql/country_registrations_daily_asof.sql',
'kpi-automation/sql/cusum_hourly_registrations.sql','kpi-automation/sql/cusum_today_reconstruct.sql',
'kpi-automation/sql/receipts_tpv_daily_asof.sql','kpi-automation/sql/rolling_30d_active_paying_49days.sql',
'kpi-automation/sql/rolling_30d_by_country_49days.sql','merchant-base-automation/queries/q1_base.sql'];
function expand(sql){
  return sql
    .replace(/\/\*MERCHANT_IDS\*\//g,'0')
    .replace(/\/\*PILOT_IDS\*\//g,"'acct_0'")
    .replace(/\/\*ACCOUNT_IDS\*\//g,"'acct_0'")
    .replace(/\/\*RECENT_FROM\*\//g,"DATE '2026-01-01'")
    .replace(/\/\*ASOF\*\//g,"DATE '2026-10-12'");
}
(async()=>{const c=conn();await connect(c);let ok=0,bad=0;
for(const f of FILES){
  let sql=expand(fs.readFileSync(path.join(REPO,f),'utf8')).trim().replace(/;\s*$/,'');
  try{ await q(c,'EXPLAIN USING TEXT '+sql); console.log('  OK      '+f); ok++; }
  catch(e){ console.log('  FAIL    '+f+'\n          '+e.message.split('\n')[0]); bad++; }
}
console.log(`\n${ok}/${FILES.length} compile, ${bad} failed`);
c.destroy(()=>{}); process.exit(bad?1:0);
})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
