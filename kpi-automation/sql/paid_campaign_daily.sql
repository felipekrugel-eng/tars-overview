-- =================================================================
-- PAID ACQUISITION — campaign x day spend, across BOTH ad platforms
-- READ-ONLY (single SELECT, works with DATA_VIEWER)
-- =================================================================
-- The cost side of the Marketing dashboard. One row per platform x campaign x day, so the
-- page can filter a period and a campaign set and still divide spend by merchants.
--
-- TWO PLATFORMS, ONE SHAPE, AND THEY ARE NOT EQUIVALENT. Google rows can be divided by a
-- merchant count because Google clicks resolve to merchants. Facebook rows cannot — see
-- paid_merchants.sql for why — so the page must show Facebook spend WITHOUT a cost-per-
-- merchant beside it. Unioning them here is a convenience for the date axis, not a claim
-- that the two can be compared on efficiency.
--
-- COST_MICROS IS MICROS. Google reports cost as integer millionths of the account currency;
-- dividing by 1e6 is not a rounding convenience, it is the unit. Facebook's SPEND is already
-- in major units. Getting this backwards would understate Google spend by a million times,
-- which is at least an obvious kind of wrong.
--
-- GOOGLE RESTATES RECENT COST for a few days after the fact, so the newest two or three days
-- drift upward after first publication. The page draws them; it does not alarm on them.
-- =================================================================

WITH google AS (
    SELECT 'google'                                         AS PLATFORM,
           TO_VARCHAR("CAMPAIGN.ID")                        AS CAMPAIGN_ID,
           "CAMPAIGN.NAME"                                  AS CAMPAIGN,
           MAX("CAMPAIGN.STATUS")                           AS CAMPAIGN_STATUS,
           MAX("CAMPAIGN.ADVERTISING_CHANNEL_TYPE")         AS CHANNEL,
           TRY_TO_DATE("SEGMENTS.DATE")                     AS D,
           SUM("METRICS.COST_MICROS") / 1e6                 AS SPEND,
           SUM("METRICS.CLICKS")                            AS CLICKS,
           SUM("METRICS.IMPRESSIONS")                       AS IMPRESSIONS,
           SUM("METRICS.CONVERSIONS")                       AS PLATFORM_CONVERSIONS
    FROM LOYVERSE_DATA_LAKE.GOOGLE_ADS.CAMPAIGN
    WHERE "SEGMENTS.DATE" IS NOT NULL
    GROUP BY 1, 2, 3, 6
),
-- Meta's own conversion count. ADS_INSIGHTS.CONVERSIONS is an ARRAY and is entirely NULL on
-- this account; the number that actually exists lives in ACTIONS, an array of
-- {action_type, value} objects, and has to be flattened out. 'complete_registration' is the
-- registration event the pixel fires — Meta's claim, on Meta's attribution window
-- (ATTRIBUTION_SETTING on this account), counted by Meta. It is NOT a Loyverse merchant and
-- the two do not agree: Meta claims 22 registrations where 5 merchants carry an fbclid.
-- Kept because the gap between those numbers is the single most useful fact on the Facebook
-- panel, and hiding one half of it would hide the finding.
fb_actions AS (
    SELECT TO_VARCHAR(i.CAMPAIGN_ID)                        AS CAMPAIGN_ID,
           i.DATE_START                                     AS D,
           SUM(IFF(f.value:action_type::STRING = 'complete_registration',
                   f.value:value::FLOAT, 0))                AS REGISTRATIONS
    FROM LOYVERSE_DATA_LAKE.FACEBOOK_MARKETING.ADS_INSIGHTS i,
         LATERAL FLATTEN(input => i.ACTIONS, OUTER => TRUE) f
    WHERE i.DATE_START IS NOT NULL
    GROUP BY 1, 2
),
facebook AS (
    -- ADS_INSIGHTS is ad-grain; rolled to campaign here so both platforms share one shape.
    SELECT 'facebook'                                       AS PLATFORM,
           TO_VARCHAR(i.CAMPAIGN_ID)                        AS CAMPAIGN_ID,
           MAX(i.CAMPAIGN_NAME)                             AS CAMPAIGN,
           NULL                                             AS CAMPAIGN_STATUS,
           'FACEBOOK'                                       AS CHANNEL,
           i.DATE_START                                     AS D,
           SUM(i.SPEND)                                     AS SPEND,
           SUM(i.CLICKS)                                    AS CLICKS,
           SUM(i.IMPRESSIONS)                               AS IMPRESSIONS,
           MAX(COALESCE(a.REGISTRATIONS, 0))                AS PLATFORM_CONVERSIONS
    FROM LOYVERSE_DATA_LAKE.FACEBOOK_MARKETING.ADS_INSIGHTS i
    LEFT JOIN fb_actions a ON a.CAMPAIGN_ID = TO_VARCHAR(i.CAMPAIGN_ID) AND a.D = i.DATE_START
    WHERE i.DATE_START IS NOT NULL
    GROUP BY 1, 2, 5, 6
)
SELECT PLATFORM, CAMPAIGN_ID, CAMPAIGN, CAMPAIGN_STATUS, CHANNEL, D,
       ROUND(SPEND, 2) AS SPEND, CLICKS, IMPRESSIONS, ROUND(PLATFORM_CONVERSIONS, 2) AS PLATFORM_CONVERSIONS
FROM (SELECT * FROM google UNION ALL SELECT * FROM facebook)
WHERE D IS NOT NULL
ORDER BY D, PLATFORM, CAMPAIGN;
