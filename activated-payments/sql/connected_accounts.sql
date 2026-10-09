-- LOYVERSE PAYMENTS — MASTER MERCHANT PULL  (automation-safe, NO hardcoded IDs)
-- Source: GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNTS
--
-- Every row in CONNECTED_ACCOUNTS is a Loyverse merchant that has activated payments
-- (connected a Stripe account under the Loyverse platform). Pulling the whole table
-- therefore gives the complete, always-current payments-activated population — new
-- merchants appear automatically, so this query never needs to be rebuilt.
--
-- Feeds the account layer of the Payments Activation dashboard: identity, contact,
-- enablement, transaction-readiness, and the exact KYC blocker for anyone not yet
-- enabled to transact. a.MERCHANT_ID is the real Loyverse owner/merchant id, so the
-- dashboard links merchants directly with no email-matching hack.
SELECT
    -- identity
    a.ID                                     AS stripe_account_id,
    a.MERCHANT_ID                            AS merchant_id,
    COALESCE(a.BUSINESS_NAME, a.LEGAL_ENTITY_BUSINESS_NAME, a.DISPLAY_NAME) AS business_name,
    TRIM(COALESCE(a.LEGAL_ENTITY_FIRST_NAME,'') || ' ' || COALESCE(a.LEGAL_ENTITY_LAST_NAME,'')) AS contact_name,
    COALESCE(a.SUPPORT_EMAIL, a.EMAIL)       AS email,
    a.COUNTRY                                AS country,
    a.DEFAULT_CURRENCY                       AS default_currency,
    a.CREATED                                AS stripe_connected_at,
    a.TOS_ACCEPTANCE_DATE                    AS tos_accepted_at,
    a.TIMEZONE                               AS timezone,
    -- contact
    COALESCE(a.SUPPORT_PHONE, a.LEGAL_ENTITY_PHONE_NUMBER) AS phone,
    -- business profile / high-level location.
    -- Added 2026-10-09 for Fraud Health: verifying a merchant means checking that the
    -- declared city/state, MCC, website and statement descriptor cohere with a real
    -- business, and none of that was being pulled — which is why 168 reviewed merchants
    -- had no location, website or MCC at all. Deliberately NOT selected: street address
    -- (LEGAL_ENTITY_ADDRESS_LINE1/2), personal addresses, and date of birth. Those are
    -- identity documents, the dashboard is a static site, and city + state is the
    -- "high-level location" the review standard actually calls for.
    a.LEGAL_ENTITY_ADDRESS_CITY              AS city,
    a.LEGAL_ENTITY_ADDRESS_STATE             AS state,
    a.BUSINESS_PROFILE_MCC                   AS mcc,
    a.BUSINESS_URL                           AS business_url,
    a.PRODUCT_DESCRIPTION                    AS product_description,
    -- STATEMENT_DESCRIPTOR only. CALCULATED_STATEMENT_DESCRIPTOR was in the COALESCE here
    -- and does not exist in the Stripe share — the view carries STATEMENT_DESCRIPTOR and
    -- PAYOUT_STATEMENT_DESCRIPTOR and nothing else matching. It broke every Daily
    -- Activation Pull from the moment it was added (9 consecutive failures, 0 successes)
    -- because connected_accounts is the FIRST query and pull.js exits on its failure.
    a.STATEMENT_DESCRIPTOR                   AS statement_descriptor,
    -- enablement / transaction readiness
    a.CHARGES_ENABLED                        AS charges_enabled,
    a.PAYOUTS_ENABLED                        AS payouts_enabled,
    a.DETAILS_SUBMITTED                      AS details_submitted,
    a.CAPABILITIES_CARD_PAYMENTS             AS card_payments_capability,
    a.CAPABILITIES_TRANSFERS                 AS transfers_capability,
    a.LEGAL_ENTITY_TYPE                      AS legal_entity_type,
    -- KYC blocker detail (why can't they transact yet)
    a.VERIFICATION_DISABLED_REASON           AS disabled_reason,
    a.VERIFICATION_DUE_BY                    AS verification_due_by,
    a.VERIFICATION_FIELDS_NEEDED             AS verification_fields_needed,
    a.REQUIREMENTS_CURRENTLY_DUE             AS requirements_currently_due,
    a.REQUIREMENTS_PAST_DUE                  AS requirements_past_due,
    a.REQUIREMENTS_EVENTUALLY_DUE            AS requirements_eventually_due,
    a.REQUIREMENTS_PENDING_VERIFICATION      AS requirements_pending_verification,
    a.REQUIREMENTS_CURRENT_DEADLINE          AS requirements_current_deadline,
    a.LEGAL_ENTITY_VERIFICATION_STATUS       AS legal_entity_verification_status
FROM GSWUDFY_STRIPE_AWS_EU_CENTRAL_1_SHARE_ORXEAZX_TC97659.STRIPE.CONNECTED_ACCOUNTS a
ORDER BY a.CREATED DESC;
