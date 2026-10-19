// Hubs (airports, rail/bus stations, ferry terminals) and the intercity routes
// between them. Coordinates are approximate (good to a couple of km), which is
// plenty for transfer-time estimates.
//
// Two sources, merged:
//   * AIRPORTS: ~4,000 airports worldwide with scheduled service, generated from
//     the OurAirports public-domain dataset (see airports.generated.js and
//     scripts/build-airports.mjs). A hand-curated entry below wins when both exist.
//   * STATIONS + ROUTES: a curated seed (UK mainline rail, Eurostar and Western
//     Europe, Amtrak north-east, Channel ferries, intercity coaches). Outside
//     those regions only flights are available - grow coverage by adding rows.
// Routes listed are real services; PRICES are modelled separately in pricing.js
// and always labelled as estimates unless a live provider supplies them.
import { AIRPORT_ROWS } from "./airports.generated.js";

// tier: 1 = major hub, 2 = regional, 3 = small/secondary (low-cost carriers)
// longHaul: has intercontinental scheduled service (used to gate transatlantic
// flights in the estimate model; a live provider makes this moot).
const A = (code, name, city, cc, lat, lon, tier, longHaul = false) => ({
  id: `air:${code}`, type: "air", code, name: `${name} (${code})`, city, cc, lat, lon, tier, longHaul,
});
const S = (type, id, name, city, cc, lat, lon, tier = 2) => ({
  id: `${type}:${id}`, type, name, city, cc, lat, lon, tier,
});

const CURATED = [
  // ---- United Kingdom ----
  A("LHR", "Heathrow", "London", "GB", 51.47, -0.4543, 1, true),
  A("LGW", "Gatwick", "London", "GB", 51.1537, -0.1821, 1, true),
  A("STN", "Stansted", "London", "GB", 51.886, 0.2389, 2),
  A("LTN", "Luton", "London", "GB", 51.8747, -0.3683, 2),
  A("LCY", "London City", "London", "GB", 51.5053, 0.0553, 2),
  A("SEN", "Southend", "London", "GB", 51.5714, 0.6956, 3),
  A("MAN", "Manchester", "Manchester", "GB", 53.3537, -2.275, 1, true),
  A("BHX", "Birmingham", "Birmingham", "GB", 52.4539, -1.748, 2),

  // ---- France ----
  A("CDG", "Paris Charles de Gaulle", "Paris", "FR", 49.0097, 2.5479, 1, true),
  A("ORY", "Paris Orly", "Paris", "FR", 48.7233, 2.3794, 1, true),
  A("BVA", "Paris Beauvais", "Paris", "FR", 49.454, 2.1128, 3),
  A("LIL", "Lille", "Lille", "FR", 50.5619, 3.0894, 3),

  // ---- Belgium / Netherlands / Germany ----
  A("BRU", "Brussels", "Brussels", "BE", 50.901, 4.4844, 1, true),
  A("CRL", "Brussels South Charleroi", "Charleroi", "BE", 50.4592, 4.4538, 3),
  A("AMS", "Amsterdam Schiphol", "Amsterdam", "NL", 52.3105, 4.7683, 1, true),
  A("RTM", "Rotterdam The Hague", "Rotterdam", "NL", 51.9569, 4.4372, 3),
  A("EIN", "Eindhoven", "Eindhoven", "NL", 51.4501, 5.3747, 3),
  A("CGN", "Cologne Bonn", "Cologne", "DE", 50.8659, 7.1427, 2),
  A("DUS", "Düsseldorf", "Düsseldorf", "DE", 51.2895, 6.7668, 2),
  A("FRA", "Frankfurt", "Frankfurt", "DE", 50.0379, 8.5622, 1, true),

  // ---- US north-east ----
  A("JFK", "John F. Kennedy", "New York", "US", 40.6413, -73.7781, 1, true),
  A("EWR", "Newark Liberty", "New York", "US", 40.6895, -74.1745, 1, true),
  A("LGA", "LaGuardia", "New York", "US", 40.7769, -73.874, 1),
  A("HPN", "Westchester County", "White Plains", "US", 41.067, -73.7076, 3),
  A("ISP", "Long Island MacArthur", "Islip", "US", 40.7952, -73.1002, 3),
  A("SWF", "Stewart", "Newburgh", "US", 41.5041, -74.1048, 3),
  A("BOS", "Boston Logan", "Boston", "US", 42.3656, -71.0096, 1, true),
  A("PVD", "Providence T.F. Green", "Providence", "US", 41.724, -71.4281, 2),
  A("MHT", "Manchester-Boston", "Manchester NH", "US", 42.9326, -71.4357, 3),
  A("BDL", "Hartford Bradley", "Hartford", "US", 41.9389, -72.6832, 2),
  A("PHL", "Philadelphia", "Philadelphia", "US", 39.8744, -75.2424, 1, true),
  A("BWI", "Baltimore/Washington", "Baltimore", "US", 39.1774, -76.6684, 1),
  A("IAD", "Washington Dulles", "Washington", "US", 38.9531, -77.4565, 1, true),
  A("DCA", "Washington Reagan", "Washington", "US", 38.8512, -77.0402, 1),

  // ---- US Midwest / West ----
  A("ORD", "Chicago O'Hare", "Chicago", "US", 41.9742, -87.9073, 1, true),
  A("MDW", "Chicago Midway", "Chicago", "US", 41.7868, -87.7522, 2),
  A("MKE", "Milwaukee Mitchell", "Milwaukee", "US", 42.9472, -87.8966, 2),
  A("SFO", "San Francisco", "San Francisco", "US", 37.6213, -122.379, 1, true),
  A("OAK", "Oakland", "Oakland", "US", 37.7213, -122.2208, 2),
  A("SJC", "San Jose", "San Jose", "US", 37.3626, -121.9291, 2),
  A("LAX", "Los Angeles", "Los Angeles", "US", 33.9416, -118.4085, 1, true),
  A("BUR", "Burbank", "Burbank", "US", 34.2007, -118.3585, 2),
  A("LGB", "Long Beach", "Long Beach", "US", 33.8177, -118.1516, 2),
  A("SNA", "Orange County", "Santa Ana", "US", 33.6757, -117.8682, 2),
  A("ONT", "Ontario", "Ontario", "US", 34.056, -117.6012, 3),

  // ---- Rail stations ----
  S("rail", "STP", "London St Pancras International", "London", "GB", 51.5319, -0.1263, 1),
  S("rail", "KGX", "London King's Cross", "London", "GB", 51.5309, -0.1233, 1),
  S("rail", "EUS", "London Euston", "London", "GB", 51.5282, -0.1337, 1),
  S("rail", "EBD", "Ebbsfleet International", "Ebbsfleet", "GB", 51.4429, 0.3209, 3),
  S("rail", "ASI", "Ashford International", "Ashford", "GB", 51.1437, 0.8759, 3),
  S("rail", "BHM", "Birmingham New Street", "Birmingham", "GB", 52.4778, -1.8983),
  S("rail", "MAN", "Manchester Piccadilly", "Manchester", "GB", 53.477, -2.2309),
  S("rail", "GDN", "Paris Gare du Nord", "Paris", "FR", 48.8809, 2.3553, 1),
  S("rail", "LLE", "Lille Europe", "Lille", "FR", 50.639, 3.075),
  S("rail", "BXM", "Brussels-Midi / Zuid", "Brussels", "BE", 50.8357, 4.3369, 1),
  S("rail", "AMC", "Amsterdam Centraal", "Amsterdam", "NL", 52.3791, 4.9003, 1),
  S("rail", "RTD", "Rotterdam Centraal", "Rotterdam", "NL", 51.9244, 4.4691),
  S("rail", "SPL", "Schiphol Airport station", "Amsterdam", "NL", 52.3094, 4.7611),
  S("rail", "KLN", "Köln Hauptbahnhof", "Cologne", "DE", 50.943, 6.9589),
  S("rail", "NYP", "New York Penn Station", "New York", "US", 40.7506, -73.9935, 1),
  S("rail", "NWK", "Newark Penn Station", "Newark", "US", 40.7345, -74.1646),
  S("rail", "BOS", "Boston South Station", "Boston", "US", 42.3519, -71.0552, 1),
  S("rail", "BBY", "Boston Back Bay", "Boston", "US", 42.3473, -71.0752),
  S("rail", "PVD", "Providence Station", "Providence", "US", 41.8296, -71.4165),
  S("rail", "NHV", "New Haven Union Station", "New Haven", "US", 41.2979, -72.9266),
  S("rail", "STM", "Stamford", "Stamford", "US", 41.0463, -73.5426),
  S("rail", "PHL", "Philadelphia 30th Street", "Philadelphia", "US", 39.9558, -75.1818, 1),
  S("rail", "BAL", "Baltimore Penn Station", "Baltimore", "US", 39.3077, -76.6154),
  S("rail", "WAS", "Washington Union Station", "Washington", "US", 38.8973, -77.0063, 1),
  S("rail", "CHI", "Chicago Union Station", "Chicago", "US", 41.8789, -87.6403, 1),
  S("rail", "MKE", "Milwaukee Intermodal", "Milwaukee", "US", 43.0334, -87.917),

  // ---- Bus stations ----
  S("bus", "LVC", "London Victoria Coach Station", "London", "GB", 51.4945, -0.1488, 1),
  S("bus", "PBC", "Paris Bercy Seine", "Paris", "FR", 48.8393, 2.382, 1),
  S("bus", "BNB", "Brussels Nord bus station", "Brussels", "BE", 50.8607, 4.3607),
  S("bus", "SLO", "Amsterdam Sloterdijk bus station", "Amsterdam", "NL", 52.389, 4.8381),
  S("bus", "NYB", "NYC Port Authority Bus Terminal", "New York", "US", 40.757, -73.99, 1),
  S("bus", "BSB", "Boston South Station Bus Terminal", "Boston", "US", 42.3524, -71.056, 1),
  S("bus", "PHB", "Philadelphia Bus Terminal", "Philadelphia", "US", 39.9549, -75.1596),
  S("bus", "WSB", "Washington Union Station Bus", "Washington", "US", 38.8975, -77.005),
  S("bus", "CHB", "Chicago Union Station Bus", "Chicago", "US", 41.8785, -87.641),
  S("bus", "MKB", "Milwaukee Bus Station", "Milwaukee", "US", 43.0334, -87.9175),

  // ---- Ferry terminals ----
  S("ferry", "DVR", "Dover Western Docks", "Dover", "GB", 51.1285, 1.333, 2),
  S("ferry", "CAL", "Calais Ferry Terminal", "Calais", "FR", 50.9709, 1.8631, 2),
  S("ferry", "NHV", "Newhaven Ferry Port", "Newhaven", "GB", 50.786, 0.057, 3),
  S("ferry", "DIE", "Dieppe Ferry Port", "Dieppe", "FR", 49.933, 1.083, 3),
  S("ferry", "HAR", "Harwich International Port", "Harwich", "GB", 51.947, 1.287, 3),
  S("ferry", "HVH", "Hook of Holland Ferry Port", "Hook of Holland", "NL", 51.976, 4.133, 3),

  // ---- UK: more airports ----
  A("EDI", "Edinburgh", "Edinburgh", "GB", 55.95, -3.3725, 1, true),
  A("GLA", "Glasgow", "Glasgow", "GB", 55.8719, -4.4331, 2),
  A("BRS", "Bristol", "Bristol", "GB", 51.3827, -2.7191, 2),
  A("CWL", "Cardiff", "Cardiff", "GB", 51.3967, -3.3434, 3),
  A("LPL", "Liverpool John Lennon", "Liverpool", "GB", 53.3336, -2.8497, 2),
  A("NCL", "Newcastle", "Newcastle", "GB", 55.0375, -1.6917, 2),
  A("LBA", "Leeds Bradford", "Leeds", "GB", 53.8659, -1.6606, 3),
  A("EMA", "East Midlands", "Nottingham", "GB", 52.8311, -1.3281, 3),
  A("SOU", "Southampton", "Southampton", "GB", 50.9503, -1.3568, 3),
  A("EXT", "Exeter", "Exeter", "GB", 50.7344, -3.4139, 3),

  // ---- UK: mainline rail stations ----
  S("rail", "PAD", "London Paddington", "London", "GB", 51.5154, -0.1755, 1),
  S("rail", "VIC", "London Victoria", "London", "GB", 51.4952, -0.1441, 1),
  S("rail", "LST", "London Liverpool Street", "London", "GB", 51.5178, -0.0823, 1),
  S("rail", "WAT", "London Waterloo", "London", "GB", 51.5033, -0.1143, 1),
  S("rail", "CDF", "Cardiff Central", "Cardiff", "GB", 51.4757, -3.179, 1),
  S("rail", "NWP", "Newport", "Newport", "GB", 51.5896, -2.9987),
  S("rail", "SWA", "Swansea", "Swansea", "GB", 51.6251, -3.9419),
  S("rail", "BTM", "Bristol Temple Meads", "Bristol", "GB", 51.4491, -2.5813, 1),
  S("rail", "BTH", "Bath Spa", "Bath", "GB", 51.3777, -2.3569),
  S("rail", "RDG", "Reading", "Reading", "GB", 51.4586, -0.9718),
  S("rail", "OXF", "Oxford", "Oxford", "GB", 51.7534, -1.27),
  S("rail", "EXD", "Exeter St Davids", "Exeter", "GB", 50.7293, -3.5436),
  S("rail", "SOT", "Southampton Central", "Southampton", "GB", 50.9069, -1.4137),
  S("rail", "BTN", "Brighton", "Brighton", "GB", 50.829, -0.1411),
  S("rail", "CBG", "Cambridge", "Cambridge", "GB", 52.1943, 0.1371),
  S("rail", "LDS", "Leeds", "Leeds", "GB", 53.7947, -1.5476, 1),
  S("rail", "YRK", "York", "York", "GB", 53.9581, -1.0932),
  S("rail", "NCS", "Newcastle Central", "Newcastle", "GB", 54.9684, -1.6174),
  S("rail", "EDB", "Edinburgh Waverley", "Edinburgh", "GB", 55.952, -3.1896, 1),
  S("rail", "GLC", "Glasgow Central", "Glasgow", "GB", 55.859, -4.2584, 1),
  S("rail", "LIV", "Liverpool Lime Street", "Liverpool", "GB", 53.4075, -2.9778),
  S("rail", "SHF", "Sheffield", "Sheffield", "GB", 53.378, -1.4622),
  S("rail", "NOT", "Nottingham", "Nottingham", "GB", 52.9472, -1.1464),
  // airport stations (a short walk from the terminal)
  S("rail", "HXT", "Heathrow Airport station (T2&3)", "London", "GB", 51.4713, -0.4525, 2),
  S("rail", "GTW", "Gatwick Airport station", "London", "GB", 51.1565, -0.161, 2),
  S("rail", "SSD", "Stansted Airport station", "London", "GB", 51.8893, 0.2616, 2),
  S("rail", "LPK", "Luton Airport Parkway", "London", "GB", 51.8782, -0.3955, 2),
  S("rail", "BHI", "Birmingham International", "Birmingham", "GB", 52.4509, -1.7258, 2),
  S("rail", "MCA", "Manchester Airport station", "Manchester", "GB", 53.3653, -2.2733, 2),
];

// Generated airports fill in everything the curated list doesn't cover.
const curatedAirports = new Set(CURATED.filter((h) => h.type === "air").map((h) => h.code));
const GENERATED = AIRPORT_ROWS.filter((r) => !curatedAirports.has(r[0])).map(([code, name, city, cc, lat, lon, tier, gateway]) => ({
  id: `air:${code}`, type: "air", code, name: `${name} (${code})`, city, cc, lat, lon, tier, longHaul: gateway === 1,
}));

export const HUBS = [...CURATED, ...GENERATED];

// Routes. `corridor` expands an ordered list into every station pair, since
// intercity services typically run end to end and stop along the way.
const link = (mode, kind, name, a, b, extra = {}) => ({ mode, kind, name, a: `${mode}:${a}`, b: `${mode}:${b}`, ...extra });
const corridor = (mode, kind, name, ids) => {
  const out = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) out.push(link(mode, kind, name, ids[i], ids[j]));
  return out;
};

export const LINKS = [
  // Eurostar (London <-> continent)
  link("rail", "highspeed", "Eurostar", "STP", "GDN"),
  link("rail", "highspeed", "Eurostar", "STP", "BXM"),
  link("rail", "highspeed", "Eurostar", "STP", "LLE"),
  link("rail", "highspeed", "Eurostar", "STP", "RTD"),
  link("rail", "highspeed", "Eurostar", "STP", "SPL"),
  link("rail", "highspeed", "Eurostar", "STP", "AMC"),
  link("rail", "highspeed", "Eurostar", "EBD", "GDN"),
  link("rail", "highspeed", "Eurostar", "ASI", "GDN"),
  // Continental high-speed
  ...corridor("rail", "highspeed", "Thalys / Eurostar", ["GDN", "BXM", "RTD", "SPL", "AMC"]),
  link("rail", "highspeed", "Thalys / ICE", "BXM", "KLN"),
  link("rail", "highspeed", "Thalys / ICE", "GDN", "KLN"),
  link("rail", "highspeed", "TGV / Eurostar", "LLE", "GDN"),
  link("rail", "highspeed", "TGV / Eurostar", "LLE", "BXM"),
  // UK mainline ("fast" = ~130 km/h average express services)
  ...corridor("rail", "fast", "GWR", ["SWA", "CDF", "NWP", "PAD"]),
  ...corridor("rail", "fast", "GWR", ["BTM", "BTH", "RDG", "PAD"]),
  link("rail", "fast", "GWR", "PAD", "OXF"),
  link("rail", "fast", "GWR", "PAD", "EXD"),
  link("rail", "intercity", "GWR / CrossCountry", "CDF", "BTM"),
  link("rail", "intercity", "CrossCountry", "CDF", "BHM"),
  link("rail", "fast", "South Western Railway", "WAT", "SOT"),
  link("rail", "intercity", "Southern", "VIC", "BTN"),
  link("rail", "intercity", "Great Northern", "KGX", "CBG"),
  ...corridor("rail", "fast", "LNER", ["KGX", "YRK", "NCS", "EDB"]),
  link("rail", "fast", "LNER", "KGX", "LDS"),
  link("rail", "fast", "Avanti West Coast", "EUS", "BHM"),
  link("rail", "fast", "Avanti West Coast", "EUS", "MAN"),
  link("rail", "fast", "Avanti West Coast", "EUS", "LIV"),
  link("rail", "fast", "Avanti West Coast", "EUS", "GLC"),
  link("rail", "fast", "East Midlands Railway", "STP", "SHF"),
  link("rail", "fast", "East Midlands Railway", "STP", "NOT"),
  link("rail", "intercity", "CrossCountry", "BHM", "MAN"),
  link("rail", "intercity", "CrossCountry", "BHM", "LDS"),
  link("rail", "intercity", "CrossCountry", "BHM", "BTM"),
  link("rail", "intercity", "TransPennine Express", "MAN", "LDS"),
  link("rail", "intercity", "Northern", "MAN", "LIV"),
  link("rail", "intercity", "CrossCountry", "LDS", "YRK"),

  // Airport express trains (fixed fares, known journey characteristics)
  link("rail", "airport", "Heathrow Express", "PAD", "HXT", { fare: 33, speedKmh: 75 }),
  link("rail", "airport", "Gatwick Express", "VIC", "GTW", { fare: 27, speedKmh: 90 }),
  link("rail", "airport", "Thameslink to Gatwick", "STP", "GTW", { fare: 20, speedKmh: 60 }),
  link("rail", "airport", "Stansted Express", "LST", "SSD", { fare: 27, speedKmh: 80 }),
  link("rail", "airport", "Thameslink to Luton", "STP", "LPK", { fare: 17, speedKmh: 80 }),
  link("rail", "airport", "Birmingham Airport train", "BHM", "BHI", { fare: 6, speedKmh: 50 }),
  link("rail", "airport", "Manchester Airport train", "MAN", "MCA", { fare: 7, speedKmh: 50 }),
  // Amtrak Northeast Corridor
  ...corridor("rail", "intercity", "Amtrak Northeast Corridor", ["BOS", "BBY", "PVD", "NHV", "STM", "NYP", "NWK", "PHL", "BAL", "WAS"]),
  link("rail", "intercity", "Amtrak Hiawatha", "CHI", "MKE"),

  // Intercity coaches
  ...corridor("bus", "bus", "FlixBus / Eurolines", ["LVC", "PBC", "BNB", "SLO"]),
  ...corridor("bus", "bus", "Intercity coach (Greyhound/Peter Pan/etc.)", ["BSB", "NYB", "PHB", "WSB"]),
  link("bus", "bus", "Intercity coach", "CHB", "MKB"),

  // Ferries
  link("ferry", "ferry", "Dover - Calais ferry", "DVR", "CAL", { checkin: 60 }),
  link("ferry", "ferry", "Newhaven - Dieppe ferry", "NHV", "DIE", { checkin: 60 }),
  link("ferry", "ferry", "Harwich - Hook of Holland ferry", "HAR", "HVH", { checkin: 75 }),
];
