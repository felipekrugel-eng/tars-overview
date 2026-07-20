-- LOYVERSE PAYMENTS FUNNEL — top-of-funnel entry cohort (automation-safe)
-- Source: LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
--
-- The funnel begins with everyone who came into Loyverse in the US since the Loyverse
-- Payments launch (2026-07-01), PLUS the chosen pilot 500 (owner ids injected at runtime
-- from pilot500-data.js — a selected cohort, not hardcoded infrastructure).
-- LOYVERSE_ID is the Loyverse owner id and joins CONNECTED_ACCOUNTS.MERCHANT_ID, so each
-- entrant can be tracked forward through Signed up -> Enabled (KYC) -> Transacting.
-- CREATED_AT is the merchant's Loyverse registration timestamp (start of the timing clock).
SELECT
    LOYVERSE_ID   AS owner_id,
    BUSINESS_NAME AS name,
    EMAIL         AS email,
    COUNTRY       AS country,
    CREATED_AT    AS registered_at
FROM LOYVERSE_DATA_LAKE.PUBLIC.LOYVERSE_MERCHANTS
WHERE (UPPER(TRIM(COUNTRY)) = 'US' AND CREATED_AT >= '2026-07-01')
   OR LOYVERSE_ID IN (/*PILOT_IDS*/);
