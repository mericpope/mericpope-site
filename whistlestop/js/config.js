// Set LIVE_PROVIDER_URL to the base URL of a small proxy that holds your
// flight-API credentials (they must never ship in a static site). The app
// then re-prices the most promising flights with real fares.
//
//   GET {LIVE_PROVIDER_URL}/flight?from=CDG&to=JFK&date=2026-12-10
//   -> { "fare": 482, "taxesIncluded": true, "minutes": 505 }   (USD, one-way)
//
// Leave null to run entirely on the built-in estimate model.
export const LIVE_PROVIDER_URL = null;
