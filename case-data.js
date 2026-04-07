// ─── CASE DATA BLOCK ────────────────────────────────────────────────────────
// Updated by CASE × Snowflake pull. Single source of truth for all dashboard numbers.
// dataStatus: ACTUAL = live Snowflake data. PROJECTED = manual estimates.
// Last pull: 2026-04-07
const CASE_DATA = {
  "lastUpdated": "2026-04-07",
  "period": "Q1 2026 · Snowflake Live Data",
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
        null,
        null,
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
      ],
      "actual": [
        null,
        null,
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
        null,
        null,
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
      ],
      "actual": [
        null,
        null,
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
        null,
        null,
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
      ],
      "actual": [
        null,
        null,
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
        null,
        null,
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
      ],
      "actual": [
        null,
        null,
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
        null,
        null,
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
      ],
      "actual": [
        null,
        null,
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
      "value": 0,
      "label": "Registered merchants"
    },
    "active": {
      "value": 0,
      "label": "Active (last 30d)",
      "convRate": "8.0%"
    },
    "paying": {
      "value": 0,
      "label": "Paying customers",
      "convRate": "3.0%"
    },
    "paymentsEnabled": {
      "value": 0,
      "label": "Payments-enabled",
      "convRate": "3.0%"
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
      "value": "€180",
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
    "cohortVintages": []
  },
  "totalRevenue": {
    "value": 0,
    "unit": "€M/yr",
    "delta": "+-100.0%",
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
    "value": 0,
    "unit": "€/mo",
    "delta": "→ €20/mo",
    "deltaClass": "up",
    "label": "2026 target"
  },
  "activeUsers": {
    "value": 0,
    "unit": "",
    "delta": "+-100%",
    "deltaClass": "up",
    "label": "YoY"
  },
  "totalGTV": {
    "value": 0,
    "unit": "€B/yr",
    "delta": "+-100%",
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
      9.3,
      11.3,
      13.2,
      14.8,
      16.5
    ],
    "payments": [
      0.2,
      0.1,
      1.5,
      4.8,
      9.4,
      14.5
    ],
    "newPricing": [
      0,
      0.3,
      3.1,
      11,
      29.6,
      47.4
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
      26.9,
      30.9,
      38.7,
      45.9,
      52.8,
      59.9
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
      "country": "Thailand",
      "flag": "🇹🇭",
      "gtv": 349,
      "merchants": 53252,
      "avgGTV": 6559
    },
    {
      "country": "Philippines",
      "flag": "🇵🇭",
      "gtv": 250,
      "merchants": 50356,
      "avgGTV": 4968
    },
    {
      "country": "Mexico",
      "flag": "🇲🇽",
      "gtv": 216,
      "merchants": 38319,
      "avgGTV": 5639
    },
    {
      "country": "Malaysia",
      "flag": "🇲🇾",
      "gtv": 158,
      "merchants": 38006,
      "avgGTV": 4153
    },
    {
      "country": "Saudi Arabia",
      "flag": "🇸🇦",
      "gtv": 134,
      "merchants": 10945,
      "avgGTV": 12219
    },
    {
      "country": "USA",
      "flag": "🇺🇸",
      "gtv": 125,
      "merchants": 3658,
      "avgGTV": 34062
    },
    {
      "country": "Myanmar",
      "flag": "🇲🇲",
      "gtv": 78,
      "merchants": 6469,
      "avgGTV": 12086
    },
    {
      "country": "UK",
      "flag": "🇬🇧",
      "gtv": 75,
      "merchants": 4890,
      "avgGTV": 15276
    },
    {
      "country": "Spain",
      "flag": "🇪🇸",
      "gtv": 66,
      "merchants": 7195,
      "avgGTV": 9152
    },
    {
      "country": "Singapore",
      "flag": "🇸🇬",
      "gtv": 36,
      "merchants": 1899,
      "avgGTV": 19063
    }
  ],
  "churn": {
    "monthly": {
      "value": "2.1%",
      "note": "Paying merchants · below 3% benchmark"
    },
    "annual": {
      "value": "22%",
      "note": "Implied from monthly rate · target <15% by 2028"
    },
    "nrr": {
      "value": "104%",
      "note": "Target: >110% by end of 2026"
    }
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
    "TH": 0.152,
    "PH": 0.138,
    "MX": 0.105,
    "MY": 0.104,
    "SA": 0.058,
    "US": 0.054,
    "MM": 0.034,
    "GB": 0.033,
    "ES": 0.029,
    "SG": 0.016,
    "ID": 0.042,
    "VN": 0.035,
    "IN": 0.038,
    "DE": 0.022,
    "FR": 0.018,
    "IT": 0.015,
    "PT": 0.008,
    "NL": 0.007,
    "PL": 0.006,
    "CA": 0.012,
    "BR": 0.025,
    "AR": 0.01,
    "CO": 0.008,
    "CL": 0.005,
    "PE": 0.004,
    "AE": 0.012,
    "QA": 0.004,
    "KW": 0.003,
    "BH": 0.002,
    "ZA": 0.008,
    "NG": 0.006,
    "KE": 0.004,
    "EG": 0.005,
    "AU": 0.01,
    "NZ": 0.003
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
