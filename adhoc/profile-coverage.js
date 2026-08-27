// AD-HOC (2026-08-27): size the payment-profile page before building it.
//
// Three things decide the design, and all three are measurements rather than judgements:
//   1. DEVICE. Charges carry TERMINAL_READER_ID via CONNECTED_ACCOUNT_PAYMENT_METHOD_DETAILS, and
//      TERMINAL_READERS.DEVICE_TYPE names the model. But TERMINAL_READERS returned ONE row, and
//      its MERCHANT_ID was the platform account — so the readers view may only expose the
//      platform's own devices, leaving connected-account reader IDs unresolvable. If most reader
//      IDs do not resolve, the device split needs a different route (serial prefix, or the
//      hardware order fallback) and the page must say which merchants are unattributed.
//   2. RECONCILIATION. PAYMENT_METHOD_DETAILS has 19,425 rows, ANALYTICS_ACCEPTANCE_ITEMIZED has
//      18,826, and the dashboard's own TPV is $425,116 across 18,987 captured charges. Those are
//      three different populations; a page mixing them would produce percentages that do not add
//      up. This finds the difference before it becomes a number on screen.
//   3. WEIGHTING. Every mix must be by TPV, not by transaction count — a 61% debit share of
//      transactions is not a 61% debit share of money, and it is the money that drives cost.
const snowflake = require('snowflake-sdk');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEY_PATH = path.join(__dirname, '..', 'snowflake_tars_key.p8');
function readPrivateKey() {
  const pk = crypto.createPrivateKey({ key: fs.readFileSync(KEY_PATH, 'utf8'), format: 'pem' });
  return pk.export({ type: 'pkcs8', format: 'pem' });
}
const conn = snowflake.createConnection({
  account: 'ORXEAZX-TC97659', username: 'TARS_SERVICE_USER', authenticator: 'SNOWFLAKE_JWT',
  privateKey: readPrivateKey(), database: 'LOYVERSE_DATA_LAKE', schema: 'PUBLIC',
  warehouse: 'COMPUTE_WH', role: 'DATA_VIEWER',
});
const S = 'GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE';
const q = (sql) => new Promise((res, rej) => conn.execute({ sqlText: sql, complete: (e, s, r) => e ? rej(e) : res(r) }));
const show = (label, rows) => {
  console.log('\n--- ' + label + ' ---');
  if (!rows.length) return console.log('  (no rows)');
  console.table(rows.slice(0, 20));
};

// The population the dashboard already reports: succeeded, paid, captured, from 2026-04.
const BASE = `
  SELECT c.ID AS CHARGE_ID, c.ACCOUNT, c.AMOUNT, c.CURRENCY,
         TRY_TO_TIMESTAMP(TO_VARCHAR(c.CREATED)) AS TS
  FROM ${S}.CONNECTED_ACCOUNT_CHARGES c
  WHERE LOWER(c.STATUS) = 'succeeded' AND c.PAID = TRUE AND c.CAPTURED = TRUE
    AND TRY_TO_TIMESTAMP(TO_VARCHAR(c.CREATED)) >= '2026-04-01'`;

conn.connect(async (err) => {
  if (err) { console.error('connect failed:', err.message); process.exit(1); }
  try {
    console.log('=== 1. RECONCILIATION: do the three sources describe the same charges? ===');
    show('row counts', await q(`
      SELECT 'charges (succeeded+paid+captured)' AS SOURCE, COUNT(*) AS ROWS_, SUM(AMOUNT)/100 AS AMOUNT_MAJOR
      FROM (${BASE})
      UNION ALL SELECT 'payment_method_details (all)', COUNT(*), NULL FROM ${S}.CONNECTED_ACCOUNT_PAYMENT_METHOD_DETAILS
      UNION ALL SELECT 'acceptance_itemized (all)', COUNT(*), NULL FROM ${S}.ANALYTICS_ACCEPTANCE_ITEMIZED
      UNION ALL SELECT 'acceptance_itemized (authorized)', COUNT(*), NULL
        FROM ${S}.ANALYTICS_ACCEPTANCE_ITEMIZED WHERE OUTCOME_TYPE = 'authorized'`));

    show('how much of our charge base joins to payment_method_details', await q(`
      SELECT COUNT(*) AS CHARGES, COUNT(d.CHARGE_ID) AS MATCHED,
             ROUND(100.0 * COUNT(d.CHARGE_ID) / NULLIF(COUNT(*),0), 1) AS PCT_MATCHED,
             SUM(b.AMOUNT)/100 AS TPV, SUM(IFF(d.CHARGE_ID IS NULL, b.AMOUNT, 0))/100 AS TPV_UNMATCHED
      FROM (${BASE}) b
      LEFT JOIN ${S}.CONNECTED_ACCOUNT_PAYMENT_METHOD_DETAILS d ON d.CHARGE_ID = b.CHARGE_ID`));

    console.log('\n=== 2. DEVICE: does TERMINAL_READER_ID resolve to a model? ===');
    show('reader id presence on our charges, by TPV', await q(`
      SELECT IFF(d.TERMINAL_READER_ID IS NULL, 'no reader id (online / tap to phone?)', 'has reader id') AS BUCKET,
             COUNT(*) AS TXNS, SUM(b.AMOUNT)/100 AS TPV,
             ROUND(100.0 * SUM(b.AMOUNT) / SUM(SUM(b.AMOUNT)) OVER (), 1) AS PCT_TPV
      FROM (${BASE}) b
      JOIN ${S}.CONNECTED_ACCOUNT_PAYMENT_METHOD_DETAILS d ON d.CHARGE_ID = b.CHARGE_ID
      GROUP BY 1 ORDER BY TPV DESC`));

    show('distinct reader ids seen vs resolvable in TERMINAL_READERS', await q(`
      WITH seen AS (
        SELECT DISTINCT d.TERMINAL_READER_ID AS RID
        FROM (${BASE}) b JOIN ${S}.CONNECTED_ACCOUNT_PAYMENT_METHOD_DETAILS d ON d.CHARGE_ID = b.CHARGE_ID
        WHERE d.TERMINAL_READER_ID IS NOT NULL)
      SELECT COUNT(*) AS READER_IDS_ON_CHARGES,
             COUNT(r.ID) AS RESOLVE_IN_TERMINAL_READERS,
             (SELECT COUNT(*) FROM ${S}.TERMINAL_READERS) AS ROWS_IN_TERMINAL_READERS
      FROM seen LEFT JOIN ${S}.TERMINAL_READERS r ON r.ID = seen.RID`));

    show('card read method by TPV (the fallback signal if readers do not resolve)', await q(`
      SELECT COALESCE(d.CARD_READ_METHOD, '(none — not card present)') AS READ_METHOD,
             COUNT(*) AS TXNS, SUM(b.AMOUNT)/100 AS TPV,
             ROUND(100.0 * SUM(b.AMOUNT) / SUM(SUM(b.AMOUNT)) OVER (), 1) AS PCT_TPV
      FROM (${BASE}) b
      JOIN ${S}.CONNECTED_ACCOUNT_PAYMENT_METHOD_DETAILS d ON d.CHARGE_ID = b.CHARGE_ID
      GROUP BY 1 ORDER BY TPV DESC`));

    console.log('\n=== 3. THE MIX ITSELF, WEIGHTED BY TPV ===');
    for (const [label, col] of [['card brand', 'd.CARD_BRAND'], ['funding', 'd.CARD_FUNDING'],
                                ['wallet', 'd.CARD_WALLET_TYPE'], ['present vs online', 'd.TYPE'],
                                ['card country', 'd.CARD_COUNTRY']]) {
      show(label + ' by TPV', await q(`
        SELECT COALESCE(${col}::string, '(unknown)') AS SEGMENT,
               COUNT(*) AS TXNS, SUM(b.AMOUNT)/100 AS TPV,
               ROUND(100.0 * SUM(b.AMOUNT) / SUM(SUM(b.AMOUNT)) OVER (), 1) AS PCT_TPV,
               ROUND(AVG(b.AMOUNT)/100, 2) AS AVG_TICKET
        FROM (${BASE}) b
        JOIN ${S}.CONNECTED_ACCOUNT_PAYMENT_METHOD_DETAILS d ON d.CHARGE_ID = b.CHARGE_ID
        GROUP BY 1 ORDER BY TPV DESC LIMIT 12`));
    }

    console.log('\n=== 4. COST BY MIX: does ICPLUS_FEES cover our charges? ===');
    show('interchange coverage and cost in bps, by brand and funding', await q(`
      SELECT f.CARD_BRAND, f.CARD_FUNDING, f.CARD_PRESENT,
             COUNT(DISTINCT f.CHARGE_ID) AS CHARGES_WITH_COST,
             ROUND(SUM(f.TOTAL_AMOUNT)/100, 2) AS COST,
             ROUND(SUM(b.AMOUNT)/100, 2) AS TPV,
             ROUND(10000.0 * SUM(f.TOTAL_AMOUNT) / NULLIF(SUM(b.AMOUNT),0), 1) AS COST_BPS
      FROM ${S}.ICPLUS_FEES f
      JOIN (${BASE}) b ON b.CHARGE_ID = f.CHARGE_ID
      GROUP BY 1,2,3 ORDER BY TPV DESC LIMIT 15`));

    console.log('\n=== 5. ACCEPTANCE: approval rate, and what the declines cost us ===');
    show('outcome by TPV attempted', await q(`
      SELECT OUTCOME_TYPE, COUNT(*) AS ATTEMPTS, ROUND(SUM(AMOUNT_IN_USD)/100, 2) AS USD_ATTEMPTED,
             ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) AS PCT_ATTEMPTS
      FROM ${S}.ANALYTICS_ACCEPTANCE_ITEMIZED GROUP BY 1 ORDER BY ATTEMPTS DESC`));
    show('top decline reasons', await q(`
      SELECT COALESCE(FAILURE_REASON, BLOCK_REASON, '(none)') AS REASON, COUNT(*) AS N,
             ROUND(SUM(AMOUNT_IN_USD)/100, 2) AS USD_LOST
      FROM ${S}.ANALYTICS_ACCEPTANCE_ITEMIZED
      WHERE OUTCOME_TYPE <> 'authorized' GROUP BY 1 ORDER BY N DESC LIMIT 12`));
  } catch (e) {
    console.error('failed:', e.message);
    process.exitCode = 1;
  } finally { conn.destroy(() => {}); }
});
