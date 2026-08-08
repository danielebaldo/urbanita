/* A small fake corner of Wikipedia + Wikidata. */

export function makeWorld(overrides = {}) {
  return {
    articles: {
      'Lisbon': {
        type: 'standard', title: 'Lisbon', description: 'Capital city of Portugal',
        extract: 'Lisbon is the capital and largest city of Portugal.',
        thumbnail: { source: 'https://x/lisbon.jpg', width: 320, height: 213 },
        coordinates: { lat: 38.7223, lon: -9.1393 },
        content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Lisbon' } }
      },
      'Porto': {
        type: 'standard', title: 'Porto', extract: 'Porto is a city in Portugal.',
        coordinates: { lat: 41.1579, lon: -8.6291 },
        content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Porto' } }
      },
      'Bordeaux': {
        type: 'standard', title: 'Bordeaux', extract: 'Bordeaux is a port city in France.',
        coordinates: { lat: 44.8378, lon: -0.5792 },
        content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Bordeaux' } }
      },
      'Singapore': {
        type: 'standard', title: 'Singapore', extract: 'Singapore is a city-state.',
        coordinates: { lat: 1.3521, lon: 103.8198 },
        content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Singapore' } }
      },
      'Java': {
        type: 'standard', title: 'Java (programming language)',
        description: 'Object-oriented programming language',
        extract: 'Java is a high-level programming language.',
        content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Java_(programming_language)' } }
      },
      'Mount Fuji': {
        type: 'standard', title: 'Mount Fuji', extract: 'Mount Fuji is the tallest mountain in Japan.',
        coordinates: { lat: 35.3606, lon: 138.7274 },   // has coords but is NOT a city
        content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Mount_Fuji' } }
      },
      'Jakarta': {
        type: 'standard', title: 'Jakarta', extract: 'Jakarta is the capital of Indonesia.',
        coordinates: { lat: -6.2088, lon: 106.8456 },
        content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Jakarta' } }
      },
      'Springfield': { type: 'disambiguation', title: 'Springfield' }
    },

    redirects: { 'Java (programming language)': 'Java (programming language)' },
    normalized: { 'lisbon': 'Lisbon' },

    search: {
      'Java': ['Java (programming language)', 'Java', 'Jakarta'],
      'Springfield': ['Springfield, Massachusetts', 'Springfield, Illinois', 'Springfield (The Simpsons)'],
      'Zzzqqq': [],
      'Mount Fuji': ['Mount Fuji', 'Fujinomiya']
    },

    qids: {
      'Lisbon': 'Q597', 'Porto': 'Q36433', 'Bordeaux': 'Q1479',
      'Singapore': 'Q334', 'Jakarta': 'Q3630',
      'Java (programming language)': 'Q251', 'Java': 'Q3757',
      'Mount Fuji': 'Q39231', 'Fujinomiya': 'Q391034',
      'Springfield, Massachusetts': 'Q49189',
      'Springfield, Illinois': 'Q28515',
      'Springfield (The Simpsons)': 'Q1077'
    },

    /* instance of */
    p31: {
      Q597:   ['Q515', 'Q5119'],        // city, capital        -> depth 0
      Q36433: ['Q515'],
      Q1479:  ['Q484170'],              // commune of France    -> 1 hop
      Q334:   ['Q6256', 'Q133442'],     // country, city-state  -> depth 0
      Q3630:  ['Q515'],
      Q49189: ['Q1093829'],             // city of the US       -> depth 0
      Q28515: ['Q1093829'],
      Q251:   ['Q9143'],                // programming language -> false
      Q3757:  ['Q23442'],               // island               -> false
      Q39231: ['Q8502'],                // mountain             -> false
      Q391034:['Q1093829'],
      Q1077:  ['Q1140229']              // fictional location   -> false
    },

    /* subclass of */
    p279: {
      Q484170:  ['Q21869758'],          // commune of France -> commune
      Q21869758:['Q15284'],             // commune -> municipality (ROOT) @ hop 2
      Q9143:    ['Q20202269'],
      Q20202269:[],
      Q23442:   ['Q271669'],            // island -> landform
      Q271669:  [],
      Q8502:    ['Q271669'],
      Q1140229: []
    },

    /* country (P17) */
    p17: {
      Q597:  ['Q45'],    // Lisbon -> Portugal
      Q1479: ['Q142']    // Bordeaux -> France
    },

    /* timezone (P421) — Lisbon only, exercises partial facts elsewhere */
    p421: {
      Q597: ['Q6072']    // Western European Time
    },

    /* population (P1082) — plain numbers, dimensionless */
    p1082: {
      Q597:  506654,     // Lisbon
      Q1479: 254436      // Bordeaux
    },

    /* population's `point in time` (P585) qualifier — Lisbon only, so
       Bordeaux exercises the case of a population with no recorded year */
    p1082Year: {
      Q597: 2021
    },

    /* area (P2046) — { amount, unit: Q-ID of the unit, or an unrecognized one } */
    p2046: {
      Q597:    { amount: 100.05, unit: 'Q712226' },  // Lisbon, km²
      Q999999: { amount: 5,      unit: 'Q999998' }   // synthetic: unrecognized unit
    },

    /* elevation above sea level (P2044) */
    p2044: {
      Q597: { amount: 2, unit: 'Q11573' }   // Lisbon, metres
    },

    /* English labels for entities referenced above */
    labels: {
      Q45:   'Portugal',
      Q142:  'France',
      Q6072: 'Western European Time'
    },

    ...overrides
  };
}
