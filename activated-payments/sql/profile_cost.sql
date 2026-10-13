-- LOYVERSE PAYMENTS — PAYMENT PROFILE: what each slice of the mix COSTS (automation-safe)
--
-- Mix on its own is trivia. The reason it matters is that the segments cost very different
-- amounts to accept. Measured properly: Visa debit ~190bp, Visa credit ~300bp, American Express
-- ~305bp. A shift in mix moves the take rate without anything else changing.
--
-- THE FANOUT THIS QUERY EXISTS TO AVOID. ICPLUS_FEES is FEE-grained, not charge-grained: one
-- charge carries several fee rows (interchange, scheme fees, and so on). Joining it straight to
-- the charge amount repeats that amount once per fee row. A scouting query did exactly that and
-- reported $1,569,139 of Visa-debit TPV against a real $169,359 — nine times over — so its cost
-- figures came out near 20bp instead of 190bp. Same dollars of cost, wrong denominator, and an
-- order of magnitude out. Those numbers must not be reused.
--
-- The fix is the whole shape of this query: collapse fees to ONE ROW PER CHARGE first, then join
-- to the charge once. The charge amount is then counted exactly once, and bps is honest.
--
-- Card attributes come from ICPLUS_FEES itself (CARD_BRAND, CARD_FUNDING, CARD_PRESENT) rather
-- than from the payment-method view, so cost and its denominator are described by the same
-- source and cannot disagree about what a charge was.
--
-- THE SOURCE COLLISION, AND WHY COST_MINOR IS NOT EVERY FEE ROW (2026-10-13).
-- Stripe bills per_auth and volume fees TWICE over in this share, in two different places:
-- itemised per charge here in ICPLUS_FEES, and in aggregate on the platform's balance
-- transactions, which is where the Summary of Margins reads them. Summing every ICPLUS row
-- and then adding the platform figure on top would count them twice; summing every ICPLUS
-- row and NOT adding the platform figure — which is what this query used to do — leaves the
-- two pages quoting different costs for the same book, with nothing saying why.
--
-- Measured, the two sources disagree slightly, and the platform feed is the larger:
--
--     per_auth   GBP 2,046.26 per-charge   vs   GBP 2,069.62 platform   (+1.1%)
--     volume     GBP 1,051.70 per-charge   vs   GBP 1,073.11 platform   (+2.0%)
--
-- The platform figure is what Stripe actually took out of the balance, including fees on
-- charges the per-charge feed has not itemised yet, so it is the truth about how much was
-- paid; the per-charge feed is the truth about WHO incurred it. So the page takes the TOTAL
-- from the platform feed and uses the per-charge split only to attribute it. This query
-- therefore returns network cost in COST_MINOR and keeps the two fees in a separate column.
--
-- REVENUE IS HERE TOO, so the page can show margin rather than only cost.
--
-- NOT from CONNECTED_ACCOUNT_APPLICATION_FEES. That view is EMPTY in this share — a fact
-- app_fees_by_account.sql already documented, and a first cut of this query used it anyway and
-- produced $0 of revenue on every row. The authoritative source is the fee-detail lines on the
-- connected account's balance transactions, TYPE = 'application_fee', which is what the Overview
-- and Margins pages already read.
--
-- Those lines carry no charge id, only BALANCE_TRANSACTION_ID — so the link runs
-- charge -> its balance transaction -> the application-fee line on it. Same fanout discipline as
-- the cost side: collapsed to one row per balance transaction before joining.

WITH base AS (
    SELECT
        c.ID                                                        AS CHARGE_ID,
        c.ACCOUNT                                                   AS ACCT,
        TO_VARCHAR(TO_DATE(TRY_TO_TIMESTAMP(TO_VARCHAR(c.CREATED))), 'YYYY-MM') AS MONTH,
        c.AMOUNT                                                    AS AMOUNT_MINOR,
        c.BALANCE_TRANSACTION_ID                                    AS BTXN_ID,
        UPPER(TRIM(c.CURRENCY))                                     AS CCY
    FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNT_CHARGES c
    WHERE c.ACCOUNT IN (/*ACCOUNT_IDS*/)
      AND LOWER(c.STATUS) = 'succeeded'
      AND c.PAID = TRUE
      AND c.CAPTURED = TRUE
      AND TRY_TO_TIMESTAMP(TO_VARCHAR(c.CREATED)) IS NOT NULL
      AND TRY_TO_TIMESTAMP(TO_VARCHAR(c.CREATED)) >= '2026-04-01'
),
-- COLLAPSE FIRST. One row per charge, carrying the summed cost and the card attributes, which
-- are constant across a charge's fee rows. MAX() picks that constant without needing a GROUP BY
-- on columns that would re-introduce the fanout.
fee_per_charge AS (
    SELECT
        f.CHARGE_ID,
        -- NETWORK COST ONLY: interchange, scheme fees, discount. See the SOURCE COLLISION
        -- note in the header — per_auth_fee and volume_fee are deliberately NOT in this sum.
        SUM(IFF(LOWER(f.FEE_NAME) IN ('per_auth_fee', 'volume_fee'),
                0, f.TOTAL_AMOUNT))                          AS COST_MINOR,
        -- The same two fees, kept separately. Not used as cost by the page — the platform
        -- balance feed is the authority for their TOTAL — but emitted so the two sources can
        -- be compared on every refresh instead of being assumed to agree, and so the split
        -- across segments is available for attribution.
        SUM(IFF(LOWER(f.FEE_NAME) IN ('per_auth_fee', 'volume_fee'),
                f.TOTAL_AMOUNT, 0))                          AS PER_CHARGE_PLATFORM_MINOR,
        LOWER(MAX(f.CARD_BRAND))                             AS BRAND,
        LOWER(MAX(f.CARD_FUNDING))                           AS FUNDING,
        MAX(IFF(f.CARD_PRESENT, 'present', 'not_present'))   AS PRESENCE,
        UPPER(MAX(f.CARD_COUNTRY))                           AS CARD_COUNTRY,
        UPPER(MAX(f.FEE_CURRENCY))                           AS FEE_CCY,
        COUNT(*)                                             AS FEE_ROWS
    FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.ICPLUS_FEES f
    WHERE f.CHARGE_ID IS NOT NULL
    GROUP BY f.CHARGE_ID
),
-- Application-fee revenue per balance transaction, collapsed the same way.
fee_rev_per_btxn AS (
    SELECT
        fd.BALANCE_TRANSACTION_ID   AS BTXN_ID,
        SUM(fd.AMOUNT)              AS REV_MINOR,
        UPPER(MAX(fd.CURRENCY))     AS REV_CCY
    FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNT_BALANCE_TRANSACTION_FEE_DETAILS fd
    WHERE LOWER(fd.TYPE) = 'application_fee'
      AND fd.BALANCE_TRANSACTION_ID IS NOT NULL
    GROUP BY fd.BALANCE_TRANSACTION_ID
)
-- Now the join is one-to-one, so AMOUNT_MINOR is counted once per charge.
--
-- CHARGES_PRICED is emitted next to TXNS on purpose: interchange posts on Stripe's own schedule,
-- so the newest month always has charges with no cost row yet. Dividing a partial cost by a full
-- month's TPV would understate bps and look like the mix had improved. The dashboard shows the
-- priced share and flags any month that is not fully priced.
SELECT
    b.MONTH,
    b.ACCT,
    b.CCY,
    COALESCE(fc.BRAND, 'unknown')        AS BRAND,
    COALESCE(fc.FUNDING, 'unknown')      AS FUNDING,
    COALESCE(fc.PRESENCE, 'unknown')     AS PRESENCE,
    COALESCE(fc.CARD_COUNTRY, 'unknown') AS CARD_COUNTRY,
    MAX(fc.FEE_CCY)                      AS FEE_CCY,
    MAX(fr.REV_CCY)                      AS REV_CCY,
    COUNT(*)                             AS TXNS,
    COUNT(fc.CHARGE_ID)                  AS CHARGES_PRICED,
    SUM(b.AMOUNT_MINOR)                  AS AMOUNT_MINOR,
    -- TPV of the priced charges only: the correct denominator for cost in bps.
    SUM(IFF(fc.CHARGE_ID IS NULL, 0, b.AMOUNT_MINOR)) AS AMOUNT_PRICED_MINOR,
    SUM(COALESCE(fc.COST_MINOR, 0))      AS COST_MINOR,
    SUM(COALESCE(fc.PER_CHARGE_PLATFORM_MINOR, 0)) AS PER_CHARGE_PLATFORM_MINOR,
    -- Revenue and the charges it covers. Application fees post on their own schedule too, so the
    -- billed subset is reported rather than assumed complete.
    SUM(COALESCE(fr.REV_MINOR, 0))       AS REV_MINOR,
    COUNT(fr.BTXN_ID)                    AS CHARGES_BILLED,
    SUM(IFF(fr.BTXN_ID IS NULL, 0, b.AMOUNT_MINOR)) AS AMOUNT_BILLED_MINOR,
    SUM(COALESCE(fc.FEE_ROWS, 0))        AS FEE_ROWS
FROM base b
LEFT JOIN fee_per_charge fc ON fc.CHARGE_ID = b.CHARGE_ID
LEFT JOIN fee_rev_per_btxn fr ON fr.BTXN_ID = b.BTXN_ID
GROUP BY b.MONTH, b.ACCT, b.CCY, 4, 5, 6, 7
ORDER BY b.MONTH, AMOUNT_MINOR DESC;
