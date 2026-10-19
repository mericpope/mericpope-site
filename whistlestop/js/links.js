// "Check live prices" links per leg. These open real third-party search pages
// so any price can be checked before booking.
const enc = encodeURIComponent;

export function legLink(leg, date) {
  if (leg.kind === "flight" && leg.fromCode && leg.toCode) {
    // Google can't be pointed at one specific flight, so this opens that day's one-way
    // results for the exact pair (narrowed to the airline and nonstop where known); the
    // flight number and departure time on the step tell you which one to pick.
    const day = leg.date || date;
    const parts = [`Flights from ${leg.fromCode} to ${leg.toCode}`];
    if (day) parts.push(`on ${day}`);
    parts.push("one way");
    if (leg.stops === 0) parts.push("nonstop");
    if (leg.airline) parts.push(`on ${leg.airline}`);
    return { href: `https://www.google.com/travel/flights?q=${enc(parts.join(" "))}`, text: "Find this flight" };
  }
  if ((leg.kind === "rail" || leg.kind === "bus" || leg.kind === "ferry") && leg.fromCity && leg.toCity) {
    return { href: `https://www.rome2rio.com/map/${enc(leg.fromCity)}/${enc(leg.toCity)}`, text: "Check schedules & fares" };
  }
  if (leg.kind === "hotel" && leg.city) {
    return { href: `https://www.google.com/travel/hotels?q=${enc(`hotels in ${leg.city}`)}`, text: "Check hotel prices" };
  }
  return null;
}
