// Departure taxes per passenger, USD, ECONOMY, rough 2025-ish levels.
//
// APPROXIMATE - these exist to make the estimate model show the single most
// important cross-border effect (e.g. UK Air Passenger Duty vs. other
// countries). They are NOT authoritative: rates change every year and depend
// on cabin and destination band. When a live fare provider is connected, its
// all-in fares include the real taxes and these are skipped (source: 'live').
//
// shape: country -> { short, long } where long applies to flights >= ~5000 km.
export const DEPARTURE_TAX_USD = {
  GB: { short: 18, long: 120 }, // Air Passenger Duty
  DE: { short: 18, long: 80 }, // Luftverkehrsteuer
  FR: { short: 12, long: 40 }, // TSBA + solidarity levy
  NL: { short: 31, long: 31 }, // Vliegbelasting
  BE: { short: 12, long: 12 }, // boarding tax
  US: { short: 0, long: 0 }, // no departure tax (ticket taxes already in fares)
};

export function departureTaxUsd(cc, distanceKm) {
  const t = DEPARTURE_TAX_USD[cc] || { short: 15, long: 40 };
  return distanceKm >= 5000 ? t.long : t.short;
}
