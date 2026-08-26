// AD-HOC (2026-08-26): why does one merchant show a Loyverse Payments charge in August but no
// POS receipt that month?
//
// The cohort triangle counts "active" from LOYVERSE_RECEIPTS_UNIQUE, applying the same hygiene
// as the KPI pipeline: money on the receipt, not cancelled, not a refund, not the refund of
// another receipt. Merchant 4990174 (Adriana Espinheira) charged a card in both July and August
// but only came back active in July, which cannot be right if every card sale writes a receipt.
//
// Three candidate explanations, and this query separates them:
//   1. Her August receipts exist but are all filtered out — refunds, cancellations, zero value.
//   2. Her August receipts have not landed in the lake yet (a freshness lag).
//   3. The Stripe charge is attributed to a different Loyverse merchant id.
// Counting raw rows alongside the filtered ones tells 1 from 2; listing every merchant id that
// shares her email covers 3.
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
const q = (sql) => new Promise((res, rej) => conn.execute({ sqlText: sql, complete: (e, s, r) => e ? rej(e) : res(r) }));

const OID = '4990174';
const EMAIL = 'adrianaemellas@gmail.com';

// Every merchant id under that email — covers the "charge attributed elsewhere" case.
const sqlIds = `
SELECT LOYVERSE_ID, ID, BUSINESS_NAME, COUNTRY, CREATED_AT
FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
WHERE LOWER(TRIM(EMAIL)) = '${EMAIL}'
ORDER BY CREATED_AT`;

// Raw vs filtered receipt counts per month. The gap between them IS explanation 1.
const sqlReceipts = `
SELECT TO_VARCHAR(TRY_TO_TIMESTAMP(RECEIPT_DATE), 'YYYY-MM')            AS MONTH,
       COUNT(*)                                                          AS RAW_ROWS,
       COUNT_IF(TOTAL_MONEY IS NOT NULL AND TOTAL_MONEY > 0
                AND CANCELLED_AT IS NULL AND REFUND_FOR IS NULL
                AND UPPER(COALESCE(RECEIPT_TYPE,'SALE')) <> 'REFUND')    AS COUNTED,
       COUNT_IF(CANCELLED_AT IS NOT NULL)                                AS CANCELLED,
       COUNT_IF(REFUND_FOR IS NOT NULL
                OR UPPER(COALESCE(RECEIPT_TYPE,'SALE')) = 'REFUND')      AS REFUNDS,
       COUNT_IF(TOTAL_MONEY IS NULL OR TOTAL_MONEY <= 0)                 AS ZERO_OR_NULL,
       MAX(TRY_TO_TIMESTAMP(RECEIPT_DATE))                               AS LAST_RECEIPT
FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_RECEIPTS_UNIQUE
WHERE MERCHANT_ID = '${OID}'
  AND TRY_TO_TIMESTAMP(RECEIPT_DATE) >= '2026-06-01'
GROUP BY 1 ORDER BY 1`;

// How fresh is the receipts table overall? If its newest row is days old, explanation 2 holds
// for everyone, not just her.
const sqlFresh = `
SELECT MAX(TRY_TO_TIMESTAMP(RECEIPT_DATE)) AS NEWEST_RECEIPT, CURRENT_TIMESTAMP() AS NOW
FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_RECEIPTS_UNIQUE
WHERE TRY_TO_TIMESTAMP(RECEIPT_DATE) >= '2026-08-01'`;

conn.connect(async (err) => {
  if (err) { console.error('connect failed:', err.message); process.exit(1); }
  try {
    console.log('=== merchant ids under', EMAIL, '===');
    console.table(await q(sqlIds));
    console.log('\n=== receipts for merchant', OID, 'since June, raw vs counted ===');
    console.table(await q(sqlReceipts));
    console.log('\n=== how fresh is the receipts table ===');
    console.table(await q(sqlFresh));
  } catch (e) {
    console.error('query failed:', e.message);
    process.exitCode = 1;
  } finally { conn.destroy(() => {}); }
});
