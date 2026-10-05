// Fraud Health data loader configuration.
// Merchant list data lives in risk-health/index.json.
// Detailed review records are loaded lazily from the detailFile referenced by each merchant.
window.LV_RISK_CONFIG = {
  schemaVersion: 2,
  indexUrl: "risk-health/index.json"
};
