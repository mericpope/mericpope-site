// "Check live prices" links per leg. These open real third-party search pages
// so any estimate can be verified before booking.
const enc = encodeURIComponent;

export function legLink(leg, date) {
  if (leg.kind === "flight" && leg.fromCode && leg.toCode) {
    const q = `Flights from ${leg.fromCode} to ${leg.toCode}${date ? ` on ${date}` : ""}`;
    return { href: `https://www.google.com/travel/flights?q=${enc(q)}`, text: "Check live fares" };
  }
  if ((leg.kind === "rail" || leg.kind === "bus" || leg.kind === "ferry") && leg.fromCity && leg.toCity) {
    return { href: `https://www.rome2rio.com/map/${enc(leg.fromCity)}/${enc(leg.toCity)}`, text: "Check schedules & fares" };
  }
  if (leg.kind === "hotel" && leg.city) {
    return { href: `https://www.google.com/travel/hotels?q=${enc(`hotels in ${leg.city}`)}`, text: "Check hotel prices" };
  }
  return null;
}
