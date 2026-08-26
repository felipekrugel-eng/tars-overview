// AD-HOC (2026-08-26): Anarchy LLC (merchant 763894) shows 0 in any triangle cell that includes
// Paying for 2026-08, while its subscription is active at $5/month and it is trading on the POS.
//
// The triangle's Paying rule is merchant_month_flags.sql: a paid, non-voided Chargebee invoice
// line whose billing period covers the month, spread across the months it bills for. So a merchant
// can be "subscribed" and not "paying" in a given month for several reasons, and only the raw
// invoice rows separate them:
//   1. The August invoice exists and is paid, and my spread is dropping it — a bug in the rule.
//   2. The invoice exists and is NOT paid — dunning, failed card. Correctly not counted.
//   3. No August invoice has been issued yet — the billing date has not come round.
//   4. The Chargebee customer email does not match the merchant email, so the join never happens.
//
// Prints the raw line items either side of August, what the spread makes of them, and the POS
// receipts, so the answer does not depend on anyone's reasoning.
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

const OID = '763894';

// 4 — does the email even join? Take the merchant's email from the lake, not from a hardcode.
const sqlWho = `
SELECT LOYVERSE_ID, LOWER(TRIM(EMAIL)) AS EMAIL_KEY, BUSINESS_NAME, COUNTRY, CREATED_AT
FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
WHERE LOYVERSE_ID = '${OID}'`;

// 1/2/3 — every plan/addon line either side of August, paid or not, with what the spread does.
const sqlLines = `
WITH me AS (
  SELECT LOWER(TRIM(EMAIL)) AS EMAIL_KEY
  FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS WHERE LOYVERSE_ID = '${OID}'
),
lines AS (
  SELECT 'UK' AS REGION, LOWER(TRIM(c.EMAIL)) AS EMAIL_KEY, i.ID AS INVOICE_ID,
         i.STATUS AS INVOICE_STATUS,
         TO_TIMESTAMP(i.PAID_AT)::DATE AS PAID_DATE,
         IFF(i.VOIDED_AT IS NULL, NULL, TO_TIMESTAMP(i.VOIDED_AT)::DATE) AS VOID_DATE,
         i.DELETED,
         TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE AS PERIOD_START,
         TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE   AS PERIOD_END,
         li.value:amount::NUMBER / 100.0                AS AMOUNT,
         li.value:entity_type::STRING                   AS ENTITY_TYPE
  FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-INVOICE" i
  JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-UK-CUSTOMER" c ON c.ID = i.CUSTOMER_ID
  CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
  WHERE LOWER(TRIM(c.EMAIL)) IN (SELECT EMAIL_KEY FROM me)
  UNION ALL
  SELECT 'EU', LOWER(TRIM(c.EMAIL)), i.ID, i.STATUS,
         TO_TIMESTAMP(i.PAID_AT)::DATE,
         IFF(i.VOIDED_AT IS NULL, NULL, TO_TIMESTAMP(i.VOIDED_AT)::DATE),
         i.DELETED,
         TO_TIMESTAMP(li.value:date_from::NUMBER)::DATE,
         TO_TIMESTAMP(li.value:date_to::NUMBER)::DATE,
         li.value:amount::NUMBER / 100.0,
         li.value:entity_type::STRING
  FROM LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-INVOICE" i
  JOIN LOYVERSE_DATA_LAKE.PUBLIC."CHARGEBEE-EU-CUSTOMER" c ON c.ID = i.CUSTOMER_ID
  CROSS JOIN LATERAL FLATTEN(input => i.LINE_ITEMS) li
  WHERE LOWER(TRIM(c.EMAIL)) IN (SELECT EMAIL_KEY FROM me)
)
SELECT REGION, INVOICE_ID, INVOICE_STATUS, DELETED, PAID_DATE, VOID_DATE,
       PERIOD_START, PERIOD_END, AMOUNT, ENTITY_TYPE,
       GREATEST(DATEDIFF('MONTH', PERIOD_START, PERIOD_END), 1) AS MONTHS_SPREAD,
       TO_VARCHAR(DATE_TRUNC('MONTH', PERIOD_START), 'YYYY-MM') AS FIRST_MONTH_CREDITED,
       -- exactly the test merchant_month_flags.sql applies
       IFF(DELETED = FALSE AND PAID_DATE IS NOT NULL AND AMOUNT > 0
           AND ENTITY_TYPE IN ('plan','addon')
           AND PAID_DATE <= CURRENT_DATE()
           AND (VOID_DATE IS NULL OR VOID_DATE > CURRENT_DATE()), 'counted', 'excluded') AS VERDICT
FROM lines
WHERE PERIOD_START >= '2026-05-01' OR PERIOD_END >= '2026-05-01'
ORDER BY PERIOD_START`;

// The POS side, to confirm independently what Felipe reported.
const sqlReceipts = `
SELECT TO_VARCHAR(TRY_TO_TIMESTAMP(RECEIPT_DATE), 'YYYY-MM') AS MONTH,
       COUNT(*) AS RECEIPTS,
       MAX(TRY_TO_TIMESTAMP(RECEIPT_DATE)) AS LAST_RECEIPT
FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_RECEIPTS_UNIQUE
WHERE MERCHANT_ID = '${OID}' AND TRY_TO_TIMESTAMP(RECEIPT_DATE) >= '2026-06-01'
  AND TOTAL_MONEY > 0 AND CANCELLED_AT IS NULL AND REFUND_FOR IS NULL
  AND UPPER(COALESCE(RECEIPT_TYPE,'SALE')) <> 'REFUND'
GROUP BY 1 ORDER BY 1`;

conn.connect(async (err) => {
  if (err) { console.error('connect failed:', err.message); process.exit(1); }
  try {
    console.log('=== the merchant ===');
    console.table(await q(sqlWho));
    console.log('\n=== Chargebee plan/addon lines from May, and what the spread rule makes of each ===');
    console.table(await q(sqlLines));
    console.log('\n=== POS receipts since June (independent check on the POS claim) ===');
    console.table(await q(sqlReceipts));
  } catch (e) {
    console.error('query failed:', e.message);
    process.exitCode = 1;
  } finally { conn.destroy(() => {}); }
});
