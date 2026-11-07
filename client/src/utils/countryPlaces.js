// =============================================================================
// Country places — reading the country a customer typed, and finding the
// nearest country DMC already ships to
//
// Customers type their delivery location's country freely, so "UK", "England"
// and "London" all have to mean the United Kingdom. For a country DMC has no
// sailing days for, DMC said to go by the countries near it that it already
// ships to (Nov 2026). Rough coordinates of each country's main port or city
// are enough to tell which of those is nearest.
//
// No imports, so the server (Node) can load this too.
// =============================================================================

// Other names people type, after lowercasing and dropping dots and "the".
const ALIASES = {
  'uk': 'united kingdom',
  'great britain': 'united kingdom',
  'britain': 'united kingdom',
  'england': 'united kingdom',
  'scotland': 'united kingdom',
  'wales': 'united kingdom',
  'northern ireland': 'united kingdom',
  'london': 'united kingdom',
  'macao': 'macau',
  'macau sar': 'macau',
  'macao sar': 'macau',
  'hk': 'hong kong',
  'hongkong': 'hong kong',
  'hong kong sar': 'hong kong',
  'usa': 'united states',
  'us': 'united states',
  'united states of america': 'united states',
  'america': 'united states',
  'uae': 'united arab emirates',
  'emirates': 'united arab emirates',
  'dubai': 'united arab emirates',
  'abu dhabi': 'united arab emirates',
  'ksa': 'saudi arabia',
  'kingdom of saudi arabia': 'saudi arabia',
  'saudi': 'saudi arabia',
  'nz': 'new zealand',
  'korea': 'south korea',
  'republic of korea': 'south korea',
  'roc': 'taiwan',
  'republic of china': 'taiwan',
  'chinese taipei': 'taiwan',
  'taipei': 'taiwan',
  'prc': 'china',
  'mainland china': 'china',
  "people's republic of china": 'china',
  'holland': 'netherlands',
  'czechia': 'czech republic',
  'saipan': 'northern mariana islands',
  'cnmi': 'northern mariana islands',
  'russian federation': 'russia',
  'viet nam': 'vietnam',
  'burma': 'myanmar',
  'east timor': 'timor-leste',
  'turkiye': 'turkey',
  'türkiye': 'turkey',
}

// [latitude, longitude] of each country's main port or city, roughly.
const PLACES = {
  // East Asia
  'hong kong': [22.3, 114.2],
  'macau': [22.2, 113.55],
  'taiwan': [22.62, 120.3],
  'japan': [35.45, 139.65],
  'south korea': [35.1, 129.04],
  'china': [31.23, 121.47],
  'mongolia': [47.9, 106.9],
  // Southeast Asia
  'philippines': [14.6, 120.97],
  'singapore': [1.29, 103.85],
  'malaysia': [3.0, 101.4],
  'brunei': [4.9, 114.94],
  'indonesia': [-6.1, 106.88],
  'thailand': [13.75, 100.5],
  'vietnam': [10.77, 106.7],
  'cambodia': [11.55, 104.92],
  'laos': [17.97, 102.6],
  'myanmar': [16.8, 96.15],
  'timor-leste': [-8.56, 125.57],
  // South Asia
  'india': [19.08, 72.88],
  'pakistan': [24.86, 67.0],
  'bangladesh': [22.33, 91.83],
  'sri lanka': [6.93, 79.85],
  'nepal': [27.7, 85.3],
  'maldives': [4.18, 73.51],
  // Middle East
  'united arab emirates': [25.0, 55.06],
  'saudi arabia': [26.43, 50.1],
  'qatar': [25.29, 51.53],
  'kuwait': [29.37, 47.98],
  'bahrain': [26.23, 50.59],
  'oman': [23.6, 58.55],
  'israel': [32.82, 34.99],
  'jordan': [29.53, 35.0],
  'lebanon': [33.9, 35.5],
  'turkey': [41.0, 28.98],
  'iran': [27.18, 56.27],
  'iraq': [30.5, 47.8],
  'egypt': [31.2, 29.92],
  // Europe
  'united kingdom': [51.5, -0.12],
  'ireland': [53.35, -6.26],
  'iceland': [64.15, -21.94],
  'cyprus': [34.68, 33.04],
  'malta': [35.9, 14.5],
  'greece': [37.94, 23.64],
  'italy': [41.9, 12.5],
  'spain': [40.42, -3.7],
  'portugal': [38.72, -9.14],
  'france': [48.86, 2.35],
  'germany': [53.55, 9.99],
  'netherlands': [51.92, 4.48],
  'belgium': [51.22, 4.4],
  'luxembourg': [49.61, 6.13],
  'switzerland': [47.38, 8.54],
  'austria': [48.21, 16.37],
  'denmark': [55.68, 12.57],
  'norway': [59.91, 10.75],
  'sweden': [59.33, 18.07],
  'finland': [60.17, 24.94],
  'poland': [52.23, 21.01],
  'czech republic': [50.08, 14.44],
  'hungary': [47.5, 19.04],
  'romania': [44.43, 26.1],
  'croatia': [45.81, 15.98],
  'russia': [55.76, 37.62],
  // Oceania and the Pacific
  'australia': [-33.87, 151.21],
  'new zealand': [-36.85, 174.76],
  'papua new guinea': [-9.44, 147.18],
  'fiji': [-18.14, 178.44],
  'guam': [13.44, 144.79],
  'northern mariana islands': [15.18, 145.75],
  'palau': [7.34, 134.48],
  'micronesia': [6.92, 158.16],
  'marshall islands': [7.09, 171.38],
  'solomon islands': [-9.43, 159.95],
  'vanuatu': [-17.73, 168.32],
  'new caledonia': [-22.27, 166.45],
  'samoa': [-13.83, -171.76],
  'tonga': [-21.14, -175.2],
  'hawaii': [21.31, -157.86],
  // The Americas
  'canada': [49.28, -123.12],
  'united states': [33.74, -118.27],
  'mexico': [19.05, -104.32],
  'panama': [8.98, -79.52],
  'colombia': [10.39, -75.51],
  'peru': [-12.05, -77.14],
  'chile': [-33.04, -71.63],
  'brazil': [-23.96, -46.33],
  'argentina': [-34.6, -58.38],
  // Africa
  'south africa': [-29.87, 31.03],
  'kenya': [-4.04, 39.67],
  'tanzania': [-6.82, 39.28],
  'nigeria': [6.45, 3.4],
  'morocco': [33.6, -7.62],
}


// The name a country goes by here: lowercase, with other names mapped, so
// " Hong Kong", "hongkong" and "HK" are all "hong kong".
export function countryName(raw) {
  const plain = String(raw || '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the /, '')
  return ALIASES[plain] || plain
}

// Whether the place of a country is known here.
export const isKnownPlace = (raw) => Boolean(PLACES[countryName(raw)])


// Kilometres between two [latitude, longitude] points, over the earth's surface.
export function distanceKm([lat1, lon1], [lat2, lon2]) {
  const rad = (degrees) => (degrees * Math.PI) / 180
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)))
}


// Of the candidates (country names as saved), the one nearest to the country,
// with how far it is. Null when either place isn't known here.
export function nearestCountry(raw, candidates = []) {
  const here = PLACES[countryName(raw)]
  if (!here) return null

  let best = null
  for (const candidate of candidates) {
    const there = PLACES[countryName(candidate)]
    if (!there || countryName(candidate) === countryName(raw)) continue
    const km = distanceKm(here, there)
    if (!best || km < best.km) best = { country: candidate, km }
  }

  return best
}
