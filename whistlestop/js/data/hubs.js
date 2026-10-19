// Curated seed dataset: hubs (airports, rail/bus stations, ferry terminals)
// and the intercity routes between them. Coordinates are approximate
// (good to a couple of km), which is plenty for transfer-time estimates.
//
// This is deliberately a *seed*: it covers the UK, Benelux/France/Germany and
// the US east coast + Chicago + California. Coverage grows by adding rows
// here (or by generating this file from OpenStreetMap/OurAirports - see
// README). Routes listed are real services; PRICES are modelled separately
// in pricing.js and always labelled as estimates unless a live provider
// supplies them.

// tier: 1 = major hub, 2 = regional, 3 = small/secondary (low-cost carriers)
// longHaul: has intercontinental scheduled service (used to gate transatlantic
// flights in the estimate model; a live provider makes this moot).
const A = (code, name, city, cc, lat, lon, tier, longHaul = false) => ({
  id: `air:${code}`, type: "air", code, name: `${name} (${code})`, city, cc, lat, lon, tier, longHaul,
});
const S = (type, id, name, city, cc, lat, lon, tier = 2) => ({
  id: `${type}:${id}`, type, name, city, cc, lat, lon, tier,
});

export const HUBS = [
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
];

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
  // UK intercity
  link("rail", "highspeed", "Avanti West Coast", "EUS", "BHM"),
  link("rail", "highspeed", "Avanti West Coast", "EUS", "MAN"),
  link("rail", "intercity", "CrossCountry", "BHM", "MAN"),
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
