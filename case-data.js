// ─── CASE DATA BLOCK ───────────────────────────────────────────────────────────────
// Updated by CASE × Snowflake pull. Single source of truth for all dashboard numbers.
// dataStatus: ACTUAL = live Snowflake data. PROJECTED = manual estimates.
// Last pull: 2026-04-08
const CASE_DATA = {
  "lastUpdated": "2026-04-08",
  "period": "Q2 2026 · Snowflake Live Data",
  "dataStatus": "ACTUAL",
  "targets2026": {
    "totalRevenue": 9.7,
    "paymentRevenue": 0.1,
    "arpc": 20,
    "activeUsers": 400000,
    "totalGTV": 30.9,
    "attachRate": 8,
    "takeRate": 0.06
  },
  "monthly2026": {
    "months": [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec"
    ],
    "revenue": {
      "target": [
        0.73,
        0.75,
        0.78,
        0.8,
        0.82,
        0.85,
        0.87,
        0.89,
        0.91,
        0.93,
        0.95,
        0.97
      ],
      "actual": [
        0.862,
        0.881,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null
      ]
    },
    "paymentRevenue": {
      "target": [
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ],
      "actual": [
        0,
        0,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null
      ]
    },
    "arpc": {
      "target": [
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ],
      "actual": [
        0,
        0,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null
      ]
    },
    "activeUsers": {
      "target": [
        340000,
        345000,
        350000,
        360000,
        365000,
        370000,
        375000,
        380000,
        385000,
        390000,
        395000,
        400000
      ],
      "actual": [
        343290,
        349123,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null
      ]
    },
    "gtv": {
      "target": [
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ],
      "actual": [
        5617.5,
        2612321.4,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null
      ]
    }
  },
  "funnel": {
    "registered": {
      "value": 13922195,
      "label": "Registered merchants"
    },
    "active": {
      "value": 227241,
      "label": "Active (last 30d)",
      "convRate": "1.6%"
    },
    "paying": {
      "value": 70226,
      "label": "Paying customers",
      "convRate": "30.9%"
    },
    "paymentsEnabled": {
      "label": "Payments-enabled"
    }
  },
  "funnelTargets2026": {
    "registered": 5000000,
    "active": 400000,
    "paying": 20000,
    "paymentsEnabled": 1600
  },
  "unitEconomics": {
    "avgNpvPerCohort": {
      "value": "€180",
      "target": "€360+",
      "note": "Software-only today → 2× with payments"
    },
    "avgLtvPerCohort": {
      "value": "€195",
      "target": "€216",
      "note": "36-month LTV per merchant in cohort"
    },
    "cac": {
      "value": "~€0",
      "target": "<€5",
      "note": "Organic acquisition"
    },
    "payback": {
      "value": "18mo",
      "target": "14mo",
      "note": "Months to recover"
    },
    "grossMargin": {
      "value": "68%",
      "target": "69%",
      "note": "Revenue minus COGS"
    },
    "ltvCacRatio": {
      "value": ">40×",
      "target": ">40×",
      "note": "Organic model"
    },
    "cohortVintages": [
      {
        "month": "2024-01",
        "merchants": 45000,
        "npv": 120,
        "ltv": 145,
        "arpc": 12,
        "paymentPct": 0
      },
      {
        "month": "2024-04",
        "merchants": 52000,
        "npv": 135,
        "ltv": 158,
        "arpc": 13,
        "paymentPct": 0
      },
      {
        "month": "2024-07",
        "merchants": 58000,
        "npv": 148,
        "ltv": 170,
        "arpc": 14,
        "paymentPct": 0
      },
      {
        "month": "2024-10",
        "merchants": 63000,
        "npv": 160,
        "ltv": 178,
        "arpc": 14.5,
        "paymentPct": 0
      },
      {
        "month": "2025-01",
        "merchants": 68000,
        "npv": 170,
        "ltv": 185,
        "arpc": 15,
        "paymentPct": 0.5
      },
      {
        "month": "2025-07",
        "merchants": 75000,
        "npv": 180,
        "ltv": 195,
        "arpc": 16,
        "paymentPct": 1.2
      }
    ]
  },
  "totalRevenue": {
    "value": 9.82,
    "unit": "€M/yr",
    "delta": "+29.2%",
    "deltaClass": "up",
    "label": "YoY growth"
  },
  "paymentRevenue": {
    "value": 0,
    "unit": "€M/yr",
    "delta": "→ €0.0M",
    "deltaClass": "up",
    "label": "2026 target"
  },
  "arpc": {
    "value": 11.66,
    "unit": "€/mo",
    "delta": "→ €20/mo",
    "deltaClass": "up",
    "label": "2026 target"
  },
  "activeUsers": {
    "value": 349123,
    "unit": "",
    "delta": "+26%",
    "deltaClass": "up",
    "label": "YoY"
  },
  "totalGTV": {
    "value": 241941.4,
    "unit": "€B/yr",
    "delta": "+1033838%",
    "deltaClass": "up",
    "label": "YoY"
  },
  "attachRate": {
    "value": 0,
    "unit": "%",
    "delta": "→ 5%",
    "deltaClass": "up",
    "label": "2026 target"
  },
  "gtvProcessed": {
    "value": 0,
    "unit": "€B/yr",
    "delta": "+40%",
    "deltaClass": "up",
    "label": "YoY"
  },
  "takeRate": {
    "value": 0,
    "unit": "%",
    "delta": "→ 0.05%",
    "deltaClass": "up",
    "label": "2026 target"
  },
  "cohortNPV": {
    "value": 1.2,
    "unit": "×",
    "delta": "→ 2×",
    "deltaClass": "up",
    "label": "vs software-only"
  },
  "cohortSoftware": "€180",
  "cohortPayments": "€216",
  "cohortTarget": "€360+",
  "revenueProjection": {
    "years": [
      2025,
      2026,
      2027,
      2028,
      2029,
      2030
    ],
    "addOn": [
      7.6,
      8.5,
      9.5,
      10.5,
      11.5,
      12.5
    ],
    "payments": [
      null,
      0.1,
      1.5,
      5,
      12,
      25
    ],
    "newPricing": [
      null,
      1.1,
      3,
      5.5,
      8,
      11
    ]
  },
  "gtvProjection": {
    "years": [
      2025,
      2026,
      2027,
      2028,
      2029,
      2030
    ],
    "values": [
      23.4,
      30.9,
      40,
      52,
      67,
      85
    ]
  },
  "cohortCurve": {
    "months": [
      0,
      1,
      6,
      12,
      24,
      60
    ],
    "pct": [
      0,
      0.5,
      1.5,
      6,
      12,
      20
    ]
  },
  "topMarkets": [
    {
      "country": "ph",
      "flag": "",
      "gtv": 5.1879068764,
      "merchants": 1762226,
      "avgGTV": 0.000002943951
    },
    {
      "country": "th",
      "flag": "",
      "gtv": 3.5767681164,
      "merchants": 1676525,
      "avgGTV": 0.000002133442
    },
    {
      "country": "id",
      "flag": "",
      "gtv": 0.3279324349,
      "merchants": 1172470,
      "avgGTV": 2.79694e-7
    },
    {
      "country": "mx",
      "flag": "",
      "gtv": 18.019439201,
      "merchants": 1135976,
      "avgGTV": 0.000015862518
    },
    {
      "country": "my",
      "flag": "",
      "gtv": 0.4400058484,
      "merchants": 980855,
      "avgGTV": 4.48594e-7
    },
    {
      "country": "vn",
      "flag": "",
      "gtv": 899.0375916305,
      "merchants": 510775,
      "avgGTV": 0.001760144078
    },
    {
      "country": "br",
      "flag": "",
      "gtv": 0.25889056,
      "merchants": 455001,
      "avgGTV": 5.68989e-7
    },
    {
      "country": "us",
      "flag": "",
      "gtv": 167474.6238513905,
      "merchants": 413419,
      "avgGTV": 0.405096582042
    },
    {
      "country": "sa",
      "flag": "",
      "gtv": 0.0690947056,
      "merchants": 359240,
      "avgGTV": 1.92336e-7
    },
    {
      "country": "es",
      "flag": "",
      "gtv": 460.5206508452,
      "merchants": 308416,
      "avgGTV": 0.001493180156
    }
  ],
  "churn": {
    "monthly": {
      "value": "4.7%",
      "note": "Paying merchants · below 3% benchmark"
    },
    "annual": {
      "value": "44%",
      "note": "Implied from monthly rate · target <15% by 2028"
    },
    "nrr": {
      "value": "104%",
      "note": "Target: >110% by end of 2026"
    }
  },
  "diagnostics": {
    "runDate": "2026-04-08T16:38:07.514Z",
    "monthlyRowCounts": [
      {
        "source": "active_users",
        "month": "2025-10",
        "rows": 327126,
        "uniqueMerchants": 327126
      },
      {
        "source": "active_users",
        "month": "2025-11",
        "rows": 330456,
        "uniqueMerchants": 330456
      },
      {
        "source": "active_users",
        "month": "2025-12",
        "rows": 331800,
        "uniqueMerchants": 331800
      },
      {
        "source": "active_users",
        "month": "2026-01",
        "rows": 343290,
        "uniqueMerchants": 343290
      },
      {
        "source": "active_users",
        "month": "2026-02",
        "rows": 349123,
        "uniqueMerchants": 349123
      },
      {
        "source": "active_users",
        "month": "2026-03",
        "rows": 227241,
        "uniqueMerchants": 227241
      }
    ],
    "revenueDiag": {
      "totalRows": 999992,
      "currentYearRows": 69373,
      "currentYearAmount": 173557708,
      "minDate": "2018-04-06 05:50:52.000",
      "maxDate": "2026-04-08 10:08:27.000"
    },
    "revenueSample": [
      {
        "amount_paid": 2500,
        "total": 2500,
        "currency": "USD",
        "date": "2026-04-08 10:08:27.000"
      },
      {
        "total": 275,
        "currency": "USD",
        "date": "2026-04-08 10:07:56.000"
      },
      {
        "amount_paid": 2800,
        "total": 2800,
        "currency": "USD",
        "date": "2026-04-08 10:07:34.000"
      },
      {
        "amount_paid": 500,
        "total": 500,
        "currency": "USD",
        "date": "2026-04-08 10:04:43.000"
      },
      {
        "amount_due": 100000,
        "total": 100000,
        "currency": "USD",
        "date": "2026-04-08 10:03:50.000"
      }
    ],
    "incompleteMonthsNulled": [
      "Mar"
    ]
  },
  "appStores": {
    "googlePlay": {
      "rating": 4.9,
      "reviewCount": "498K",
      "positive": 86,
      "neutral": 8,
      "negative": 6,
      "tags": [
        {
          "label": "Easy to use",
          "type": "pos"
        },
        {
          "label": "Great for small biz",
          "type": "pos"
        },
        {
          "label": "Free POS",
          "type": "pos"
        },
        {
          "label": "Quick setup",
          "type": "pos"
        },
        {
          "label": "Support slow",
          "type": "neg"
        },
        {
          "label": "Add-on costs",
          "type": "neg"
        }
      ]
    },
    "appStore": {
      "rating": 4.8,
      "reviewCount": "129K",
      "positive": 88,
      "neutral": 7,
      "negative": 5,
      "tags": [
        {
          "label": "Simple & clean",
          "type": "pos"
        },
        {
          "label": "Works offline",
          "type": "pos"
        },
        {
          "label": "Multi-location",
          "type": "pos"
        },
        {
          "label": "Reports useful",
          "type": "pos"
        },
        {
          "label": "Payment integration",
          "type": "neg"
        },
        {
          "label": "Add-on pricing",
          "type": "neg"
        }
      ]
    }
  },
  "ratingTrend": {
    "months": [
      "Nov",
      "Dec",
      "Jan",
      "Feb",
      "Mar",
      "Apr"
    ],
    "googlePlay": [
      4.7,
      4.72,
      4.74,
      4.76,
      4.8,
      4.9
    ],
    "appStore": [
      4.76,
      4.77,
      4.78,
      4.79,
      4.8,
      4.8
    ]
  },
  "reviewThemes": [
    {
      "name": "Ease of use",
      "mentions": 2985,
      "type": "pos",
      "key": "ease-of-use"
    },
    {
      "name": "Free / value",
      "mentions": 2040,
      "type": "pos",
      "key": "free-value"
    },
    {
      "name": "Inventory features",
      "mentions": 1625,
      "type": "pos",
      "key": "inventory"
    },
    {
      "name": "Reporting",
      "mentions": 1295,
      "type": "pos",
      "key": "reporting"
    },
    {
      "name": "Customer support",
      "mentions": 955,
      "type": "neg",
      "key": "customer-support"
    },
    {
      "name": "Payment integration",
      "mentions": 695,
      "type": "neg",
      "key": "payment-integration"
    },
    {
      "name": "Sync / connectivity",
      "mentions": 515,
      "type": "neg",
      "key": "sync"
    }
  ],
  "downloads": {
    "googlePlay": {
      "total": "10M+",
      "trend": [
        890000,
        920000,
        960000,
        1010000,
        1045000,
        1070000
      ]
    },
    "appStore": {
      "total": "2M+",
      "trend": [
        192000,
        198000,
        205000,
        215000,
        222000,
        228000
      ]
    }
  },
  "reviews": {
    "googlePlay": [
      {
        "author": "PrintShopTH",
        "country": "TH",
        "region": "asia",
        "rating": 5,
        "date": "Apr 2026",
        "sentiment": "positive",
        "themes": [
          "ease-of-use",
          "free-value"
        ],
        "text": "Amazing free POS for my print shop with 2 locations. Works great, no contracts, got running in under an hour. Exactly what a small business needs."
      },
      {
        "author": "GroceryPH",
        "country": "PH",
        "region": "asia",
        "rating": 5,
        "date": "Apr 2026",
        "sentiment": "positive",
        "themes": [
          "ease-of-use",
          "inventory"
        ],
        "text": "Very user friendly and easily integrated for expansion. My staff learned it in minutes. Barcode scanning and real-time stock updates are flawless."
      },
      {
        "author": "SmoothieBarUS",
        "country": "US",
        "region": "north_america",
        "rating": 5,
        "date": "Apr 2026",
        "sentiment": "positive",
        "themes": [
          "free-value",
          "reporting"
        ],
        "text": "Compared to Square and Clover, Loyverse is the only truly free option with useful reports. Sales breakdown by payment type is a game changer."
      },
      {
        "author": "ElectroMY",
        "country": "MY",
        "region": "asia",
        "rating": 5,
        "date": "Apr 2026",
        "sentiment": "positive",
        "themes": [
          "ease-of-use",
          "inventory"
        ],
        "text": "Set up 400 SKUs using the back office in one afternoon. Incredibly intuitive — even my part-time weekend staff have zero issues with it."
      },
      {
        "author": "PerfumeSA",
        "country": "SA",
        "region": "middle_east",
        "rating": 5,
        "date": "Apr 2026",
        "sentiment": "positive",
        "themes": [
          "reporting",
          "free-value"
        ],
        "text": "Sales reports with accuracy and real-time insights. Best-selling items, hourly trends, profit margins — all free. My accountant loves it."
      },
      {
        "author": "CafeOwnerUK",
        "country": "GB",
        "region": "europe",
        "rating": 4,
        "date": "Apr 2026",
        "sentiment": "neutral",
        "themes": [
          "ease-of-use"
        ],
        "text": "Clean interface, reliable day to day. Would love table management and more receipt options but rock solid for the price."
      },
      {
        "author": "AbarrotesMX",
        "country": "MX",
        "region": "north_america",
        "rating": 4,
        "date": "Apr 2026",
        "sentiment": "neutral",
        "themes": [
          "inventory"
        ],
        "text": "Inventory tracking is solid but low-stock alerts could be smarter. Would love auto reorder suggestions. Still the best free option out there."
      },
      {
        "author": "RamenSG",
        "country": "SG",
        "region": "asia",
        "rating": 3,
        "date": "Apr 2026",
        "sentiment": "neutral",
        "themes": [
          "sync"
        ],
        "text": "Generally works well but sync between tablet and phone lags during peak lunch hour. Quick restart fixes it but costs valuable time."
      },
      {
        "author": "BookshopDE",
        "country": "DE",
        "region": "europe",
        "rating": 2,
        "date": "Apr 2026",
        "sentiment": "negative",
        "themes": [
          "customer-support"
        ],
        "text": "Receipt printing issue unresolved after 3 emails over 2 weeks. Responses are generic links to FAQ. Need better technical support."
      },
      {
        "author": "ClinicMM",
        "country": "MM",
        "region": "asia",
        "rating": 2,
        "date": "Apr 2026",
        "sentiment": "negative",
        "themes": [
          "customer-support",
          "sync"
        ],
        "text": "Inventory sync between registers keeps breaking. Support ticket open 10 days with no meaningful fix. Frustrating for a busy clinic."
      },
      {
        "author": "WineBarES",
        "country": "ES",
        "region": "europe",
        "rating": 1,
        "date": "Apr 2026",
        "sentiment": "negative",
        "themes": [
          "payment-integration"
        ],
        "text": "Tried to set up card payments for weeks. Documentation is outdated and support sends copy-paste replies. Eventually gave up."
      },
      {
        "author": "SandwichUS",
        "country": "US",
        "region": "north_america",
        "rating": 2,
        "date": "Apr 2026",
        "sentiment": "negative",
        "themes": [
          "payment-integration",
          "customer-support"
        ],
        "text": "Employee add-on costs $25/mo per person which adds up fast. Payment fees not transparent upfront. Support response took over a week."
      },
      {
        "author": "NoodleTH",
        "country": "TH",
        "region": "asia",
        "rating": 1,
        "date": "Apr 2026",
        "sentiment": "negative",
        "themes": [
          "sync",
          "customer-support"
        ],
        "text": "Kitchen display lost connection mid-service again. Orders disappeared and customers got frustrated. Bug reported weeks ago, still no fix."
      }
    ],
    "appStore": [
      {
        "author": "VintageBK",
        "country": "US",
        "region": "north_america",
        "rating": 5,
        "date": "Apr 2026",
        "sentiment": "positive",
        "themes": [
          "ease-of-use",
          "reporting"
        ],
        "text": "Switched from Square and the interface is noticeably cleaner. Reports are more intuitive and export options make my accountant happy."
      },
      {
        "author": "CoffeeMelb",
        "country": "AU",
        "region": "oceania",
        "rating": 5,
        "date": "Apr 2026",
        "sentiment": "positive",
        "themes": [
          "free-value",
          "ease-of-use"
        ],
        "text": "Two years running my cafe on Loyverse. Free, reliable, staff picks it up instantly. Best value POS I have ever used."
      },
      {
        "author": "RetailMY",
        "country": "MY",
        "region": "asia",
        "rating": 5,
        "date": "Apr 2026",
        "sentiment": "positive",
        "themes": [
          "inventory",
          "reporting"
        ],
        "text": "Managing 5 locations with multi-store inventory sync and per-location reports. This would easily cost hundreds per month elsewhere."
      },
      {
        "author": "OrganicCA",
        "country": "CA",
        "region": "north_america",
        "rating": 5,
        "date": "Apr 2026",
        "sentiment": "positive",
        "themes": [
          "ease-of-use",
          "free-value"
        ],
        "text": "Simple, clean, and actually free. Set up my health food shop in under an hour. Cannot understand why anyone pays for basic POS."
      },
      {
        "author": "BrunchDC",
        "country": "US",
        "region": "north_america",
        "rating": 4,
        "date": "Apr 2026",
        "sentiment": "positive",
        "themes": [
          "reporting"
        ],
        "text": "Training new hires takes 15 minutes and sales reports are solid. Would be 5 stars if advanced analytics did not require a paid add-on."
      },
      {
        "author": "MarketPH",
        "country": "PH",
        "region": "asia",
        "rating": 4,
        "date": "Apr 2026",
        "sentiment": "neutral",
        "themes": [
          "inventory"
        ],
        "text": "Good app overall but bulk product import would save hours. Had to enter 600 items manually which was tedious."
      },
      {
        "author": "SalonUK",
        "country": "GB",
        "region": "europe",
        "rating": 3,
        "date": "Apr 2026",
        "sentiment": "neutral",
        "themes": [
          "payment-integration"
        ],
        "text": "POS features are excellent for tracking sales. But setting up integrated card payments was confusing — needs better in-app guidance."
      },
      {
        "author": "BazaarTH",
        "country": "TH",
        "region": "asia",
        "rating": 3,
        "date": "Apr 2026",
        "sentiment": "neutral",
        "themes": [
          "sync"
        ],
        "text": "Items sometimes take over a minute to sync across devices. During busy market nights this leads to duplicate entries."
      },
      {
        "author": "CrepeParis",
        "country": "FR",
        "region": "europe",
        "rating": 2,
        "date": "Apr 2026",
        "sentiment": "negative",
        "themes": [
          "customer-support"
        ],
        "text": "Email-only support with 5 to 7 day waits is unacceptable for a business tool. Register crashed Friday, resolved the following Thursday."
      },
      {
        "author": "FarmMktUS",
        "country": "US",
        "region": "north_america",
        "rating": 1,
        "date": "Apr 2026",
        "sentiment": "negative",
        "themes": [
          "payment-integration",
          "customer-support"
        ],
        "text": "Card reader stopped working on a busy Saturday. No live support channel available. Lost an entire day of card sales."
      },
      {
        "author": "DimSumSG",
        "country": "SG",
        "region": "asia",
        "rating": 2,
        "date": "Apr 2026",
        "sentiment": "negative",
        "themes": [
          "sync",
          "customer-support"
        ],
        "text": "Kitchen display updates are unreliable — had to restart the app multiple times this week. Support ticket open 12 days with no resolution."
      },
      {
        "author": "TaqueriaMX",
        "country": "MX",
        "region": "north_america",
        "rating": 1,
        "date": "Apr 2026",
        "sentiment": "negative",
        "themes": [
          "payment-integration"
        ],
        "text": "Payment setup documentation references screens that no longer exist. Support sent an outdated PDF guide. Gave up on card payments entirely."
      }
    ]
  },
  "countryWeights": {
    "ph": 12.66,
    "th": 12.04,
    "id": 8.42,
    "mx": 8.16,
    "my": 7.05,
    "vn": 3.67,
    "br": 3.27,
    "us": 2.97,
    "sa": 2.58,
    "es": 2.22,
    "mm": 2,
    "in": 1.82,
    "co": 1.39,
    "gb": 1.34,
    "tw": 1.18,
    "cl": 1.03,
    "kr": 0.97,
    "pe": 0.9,
    "ar": 0.83,
    "eg": 0.81,
    "za": 0.8,
    "bd": 0.74,
    "pk": 0.71,
    "jp": 0.69,
    "ng": 0.68,
    "ru": 0.68,
    "au": 0.64,
    "do": 0.64,
    "kh": 0.58,
    "dz": 0.55
  },
  "regionCountries": {
    "asia": [
      "TH",
      "PH",
      "MY",
      "MM",
      "SG",
      "ID",
      "VN",
      "IN"
    ],
    "europe": [
      "GB",
      "ES",
      "DE",
      "FR",
      "IT",
      "PT",
      "NL",
      "PL"
    ],
    "north_america": [
      "US",
      "MX",
      "CA"
    ],
    "south_america": [
      "BR",
      "AR",
      "CO",
      "CL",
      "PE"
    ],
    "middle_east": [
      "SA",
      "AE",
      "QA",
      "KW",
      "BH"
    ],
    "africa": [
      "ZA",
      "NG",
      "KE",
      "EG"
    ],
    "oceania": [
      "AU",
      "NZ"
    ]
  }
};
