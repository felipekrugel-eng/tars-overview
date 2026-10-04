// Generated/maintained by the Loyverse Payments merchant legitimacy review.
// Higher score = stronger independent corroboration / lower merchant-legitimacy risk.
// This is NOT a mathematical probability of fraud.
window.LV_MERCHANT_TRUST = {
  generatedAt: "2026-10-04T10:10:00+01:00",
  methodology: {
    version: "1.0",
    weights: [
      { key:"legal", label:"Legal existence & corporate records", max:20 },
      { key:"operating", label:"Licensing / permits / operating evidence", max:20 },
      { key:"history", label:"Independent business history", max:15 },
      { key:"identity", label:"Representative / contact consistency", max:15 },
      { key:"reputation", label:"Customer reputation", max:10 },
      { key:"website", label:"Website / business coherence", max:10 },
      { key:"anomalies", label:"Risk anomalies", max:10 }
    ],
    bands: [
      { min:85, max:100, label:"Strongly verified", level:"low" },
      { min:70, max:84, label:"Low risk", level:"low" },
      { min:55, max:69, label:"Moderate", level:"moderate" },
      { min:40, max:54, label:"Enhanced review", level:"review" },
      { min:25, max:39, label:"High risk", level:"high" },
      { min:0, max:24, label:"Very high risk", level:"very-high" }
    ]
  },
  merchants: [
    {
      id:"interior-glass",
      name:"Interior Glass Inc.",
      dba:"Interior Glass",
      score:86,
      createdAt:null,
      reviewedAt:"2026-10-01",
      location:"San Jose, CA",
      representative:"Michael Yates",
      phone:"(408) 569-7118",
      email:null,
      website:"https://interiorglass.org/",
      mcc:"General contractor / glazing",
      action:"Ordinary monitoring",
      scores:{legal:20,operating:20,history:15,identity:12,reputation:8,website:6,anomalies:5},
      verified:[
        "California corporation with a long operating history",
        "Active California C-17 glazing contractor licence",
        "Long-standing 486 Santa Ana Ave business address",
        "Michael Yates independently connected to the company",
        "BBB and contractor-directory footprint"
      ],
      unverified:[
        "Merchant-supplied phone is not the historical main business number",
        "Customer-review volume is sparse for the age of the company"
      ],
      contradictions:[
        "Website positioning is broader/interior-design oriented compared with the historical glazing business"
      ],
      evidenceNeeded:[
        "Standard identity and bank-account ownership checks",
        "Transaction documentation only where activity is unusual"
      ],
      summary:"The underlying company is independently well established. Remaining concerns are mainly website/contact inconsistencies rather than business existence."
    },
    {
      id:"deleon-black",
      name:"DeLeon Black Construction LLC",
      dba:"DeLeon Black Construction",
      score:37,
      createdAt:null,
      reviewedAt:"2026-10-01",
      location:"Attleboro, MA",
      representative:"Karel DeLeon",
      phone:"(848) 281-2714",
      email:null,
      website:"https://deleonblackconstruction.com/",
      mcc:"General contractors",
      action:"Enhanced verification",
      scores:{legal:8,operating:3,history:3,identity:9,reputation:1,website:6,anomalies:7},
      verified:[
        "Submitted Attleboro address exists",
        "Representative identity is plausible",
        "Website exists and describes construction services"
      ],
      unverified:[
        "Independent legal/company history",
        "Massachusetts contractor/HIC operating footprint",
        "Historical customers and completed projects",
        "Independent customer reviews",
        "Phone-to-business linkage"
      ],
      contradictions:[
        "Submitted phone uses a New Jersey 848 area code while the business is presented as Massachusetts-based"
      ],
      evidenceNeeded:[
        "Massachusetts formation/registration documents",
        "Applicable HIC/CSL registration",
        "Government ID and bank ownership",
        "Historical customer contracts and invoices",
        "Permits and supplier/material receipts"
      ],
      summary:"The story is possible, but almost all important evidence currently comes from the merchant rather than independent sources."
    },
    {
      id:"valcrestus",
      name:"Valcrestus Property Group",
      dba:"Valcrestus Property Group",
      score:29,
      createdAt:null,
      reviewedAt:"2026-10-03",
      location:"Ridgefield, NJ",
      representative:"Daniele Costa",
      phone:"(201) 328-5628",
      email:"valcrestuspg@gmail.com",
      website:"https://valcrestus.vercel.app/",
      mcc:"1520 · General Contractors",
      action:"Enhanced verification / payout review",
      scores:{legal:6,operating:2,history:1,identity:8,reputation:0,website:7,anomalies:5},
      verified:[
        "Representative identity appears plausible and local to Ridgefield",
        "Submitted address exists and is consistent with a home-based contractor",
        "Website contains detailed construction content"
      ],
      unverified:[
        "Independent company operating history",
        "NJ home-improvement contractor registration",
        "Permit history",
        "Historical customers and completed projects",
        "Independent review footprint"
      ],
      contradictions:[
        "Phone number has a historical public association with an unrelated healthcare business",
        "Website is hosted on Vercel while referring to valcrestus.com",
        "Website email and onboarding Gmail identity do not match"
      ],
      evidenceNeeded:[
        "NJ formation and business registration documents",
        "NJ Home Improvement Contractor registration",
        "Government ID and bank ownership",
        "Explanation of phone-number history",
        "Historical contracts, permits, supplier receipts and customer/job addresses"
      ],
      summary:"The person may be genuine, but the claimed operating company currently has very little independently verifiable history and several unexplained inconsistencies."
    },
    {
      id:"two-brothers",
      name:"Two Brothers Construction",
      dba:"Two Brothers construction",
      score:13,
      createdAt:"2026-10-03T23:29:00",
      reviewedAt:"2026-10-04",
      location:"Amarillo, TX",
      representative:"Jordan Mills",
      phone:"(806) 336-6894",
      email:"jordanmills1177@gmail.com",
      website:"https://ko-fi.com/jordan1177kofiuser91301?ref=onboarding_email_founderwelcome",
      mcc:"7392 · Consulting, SEO, PR",
      statementDescriptor:"KO-FI.COM",
      identityVerification:"Not provided",
      action:"Hold/review payouts + enhanced verification",
      scores:{legal:6,operating:1,history:0,identity:4,reputation:0,website:0,anomalies:2},
      verified:[
        "Submitted Amarillo address exists",
        "806 phone geography is consistent with the Texas Panhandle"
      ],
      unverified:[
        "Two Brothers Construction operating history",
        "City of Amarillo contractor registration",
        "Jordan Mills connection to a construction business",
        "Historical customers or projects",
        "Identity verification"
      ],
      contradictions:[
        "DBA says construction while submitted website is JordanM Photography",
        "Stripe industry/MCC says consulting / SEO / PR",
        "Statement descriptor is KO-FI.COM",
        "No identity-verification attempt is associated with the account"
      ],
      evidenceNeeded:[
        "Government-issued ID",
        "Proof of residential/business address and bank ownership",
        "City of Amarillo contractor registration",
        "DBA/assumed-name registration if applicable",
        "Explanation of construction / photography / consulting mismatch",
        "Historical contracts predating the review request",
        "Permits, supplier receipts and customer/job addresses"
      ],
      summary:"The merchant-supplied evidence actively describes multiple incompatible businesses. Current construction-business legitimacy is not independently substantiated."
    }
  ]
};
