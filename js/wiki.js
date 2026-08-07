/* ==========================================================================
   Urbanita — network + classification layer
   Pure logic: no DOM access anywhere in this file.
   ========================================================================== */

const WP_REST = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
const WP_API  = 'https://en.wikipedia.org/w/api.php';
const WD_API  = 'https://www.wikidata.org/w/api.php';

// Wikipedia asks browser clients to identify themselves with Api-User-Agent
// (the real User-Agent header is locked down by browsers).
// TODO: put your own repo or site URL here before going live.
export const API_USER_AGENT = 'Urbanita/0.3 (https://github.com/YOUR-USERNAME/urbanita)';

/* --------------------------------------------------------------------------
   Wikidata classes that count as "a place someone would call a city".
   We match these directly, then walk `subclass of` (P279) upward, so
   descendants like "commune of France" resolve without being listed here.
   -------------------------------------------------------------------------- */

export const SETTLEMENT_ROOTS = new Set([
  'Q486972',   // human settlement
  'Q515',      // city
  'Q3957',     // town
  'Q532',      // village
  'Q5119',     // capital city
  'Q15284',    // municipality
  'Q1549591',  // big city
  'Q200250',   // metropolis
  'Q1637706',  // city with millions of inhabitants
  'Q7930989',  // city or town
  'Q1093829',  // city of the United States
  'Q133442'    // city-state (Singapore, Monaco, Vatican City)
]);

const MAX_SUBCLASS_HOPS = 3;
const BATCH = 50;               // API limit for titles / ids per request

/* -------------------------------------------------------------------------- */

class HttpError extends Error {
  constructor(status, message) {
    super(message || ('Wikipedia responded with ' + status));
    this.name = 'HttpError';
    this.status = status;
  }
}
export { HttpError };

async function fetchJson(url, signal) {
  const res = await fetch(url, {
    signal,
    headers: { 'Accept': 'application/json', 'Api-User-Agent': API_USER_AGENT }
  });
  if (!res.ok) throw new HttpError(res.status);
  return res.json();
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/* --------------------------------------------------------------------------
   Wikipedia
   -------------------------------------------------------------------------- */

export function fetchSummary(title, signal) {
  return fetchJson(WP_REST + encodeURIComponent(title) + '?redirect=true', signal);
}

export async function searchTitles(query, limit, signal) {
  const params = new URLSearchParams({
    action: 'query', list: 'search', srsearch: query,
    srlimit: String(limit || 10), format: 'json', origin: '*'
  });
  const data = await fetchJson(WP_API + '?' + params, signal);
  return ((data.query && data.query.search) || []).map(hit => ({
    title: hit.title,
    snippet: stripTags(hit.snippet || '')
  }));
}

/** Wikipedia search snippets arrive with <span> highlight markup. */
export function stripTags(html) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

/** Map article titles to Wikidata Q-IDs, following redirects/normalisation. */
export async function fetchQids(titles, signal) {
  const out = new Map();
  if (!titles.length) return out;

  for (const batch of chunk(titles, BATCH)) {
    const params = new URLSearchParams({
      action: 'query', prop: 'pageprops', ppprop: 'wikibase_item',
      titles: batch.join('|'), redirects: '1', format: 'json', origin: '*'
    });
    const data = await fetchJson(WP_API + '?' + params, signal);
    const q = data.query || {};

    // "nyc" -> "Nyc" -> "New York City"
    const alias = new Map();
    (q.normalized || []).forEach(n => alias.set(n.from, n.to));
    (q.redirects  || []).forEach(r => alias.set(r.from, r.to));

    const byTitle = new Map();
    Object.values(q.pages || {}).forEach(p => {
      if (p.pageprops && p.pageprops.wikibase_item) {
        byTitle.set(p.title, p.pageprops.wikibase_item);
      }
    });

    batch.forEach(t => {
      let cur = t, hops = 0;
      while (alias.has(cur) && hops++ < 5) cur = alias.get(cur);
      if (byTitle.has(cur)) out.set(t, byTitle.get(cur));
    });
  }
  return out;
}

/* --------------------------------------------------------------------------
   Wikidata
   -------------------------------------------------------------------------- */

const entityClaimsCache = new Map();   // Q-ID -> claims object

export async function fetchEntities(qids, signal) {
  const out = new Map();
  const need = [];
  for (const q of new Set(qids)) {
    if (entityClaimsCache.has(q)) out.set(q, entityClaimsCache.get(q));
    else need.push(q);
  }
  if (!need.length) return out;

  for (const batch of chunk(need, BATCH)) {
    const params = new URLSearchParams({
      action: 'wbgetentities', ids: batch.join('|'),
      props: 'claims', format: 'json', origin: '*'
    });
    const data = await fetchJson(WD_API + '?' + params, signal);
    Object.entries(data.entities || {}).forEach(([id, entity]) => {
      const claims = (entity && entity.claims) || {};
      entityClaimsCache.set(id, claims);
      out.set(id, claims);
    });
  }
  return out;
}

/**
 * Pull entity-valued claim IDs off a claims object, defensively.
 * Deprecated statements are skipped; anything unexpected is ignored.
 */
export function claimIds(claims, prop) {
  const statements = (claims && claims[prop]) || [];
  if (!Array.isArray(statements)) return [];
  return statements
    .filter(s => s && s.rank !== 'deprecated')
    .map(s => s.mainsnak)
    .filter(m => m && m.snaktype === 'value' && m.datavalue &&
                 m.datavalue.value && m.datavalue.value.id)
    .map(m => m.datavalue.value.id);
}

/**
 * The single best statement for a claim: preferred rank wins, otherwise
 * the first non-deprecated statement with a usable value. Used where a
 * display needs one authoritative value rather than every candidate.
 */
function bestStatement(claims, prop) {
  const statements = (claims && claims[prop]) || [];
  if (!Array.isArray(statements)) return null;
  const usable = statements.filter(s =>
    s && s.rank !== 'deprecated' && s.mainsnak &&
    s.mainsnak.snaktype === 'value' && s.mainsnak.datavalue
  );
  if (!usable.length) return null;
  return (usable.find(s => s.rank === 'preferred') || usable[0]).mainsnak;
}

/** The single best entity-valued claim (e.g. P17 country, P421 timezone). */
export function claimId(claims, prop) {
  const snak = bestStatement(claims, prop);
  const id = snak && snak.datavalue.value && snak.datavalue.value.id;
  return id || null;
}

/**
 * The single best quantity-valued claim (e.g. P1082 population,
 * P2046 area, P2044 elevation). Wikidata amounts arrive as signed strings
 * ("+506654"); unit is a bare "1" for dimensionless values or a full
 * entity URI, from which we keep only the trailing Q-ID.
 */
export function claimQuantity(claims, prop) {
  const snak = bestStatement(claims, prop);
  const value = snak && snak.datavalue.value;
  if (!value || value.amount === undefined) return null;
  const amount = Number(value.amount);
  if (Number.isNaN(amount)) return null;
  const unit = value.unit;
  const unitQid = (unit && unit !== '1') ? unit.split('/').pop() : null;
  return { amount, unitQid };
}

/** Batched, cached English labels for Wikidata entities (countries, timezones). */
export async function fetchLabels(qids, signal) {
  const out = new Map();
  const list = [...new Set(qids)].filter(Boolean);
  if (!list.length) return out;

  const need = list.filter(id => !labelCache.has(id));
  for (const batch of chunk(need, BATCH)) {
    const params = new URLSearchParams({
      action: 'wbgetentities', ids: batch.join('|'),
      props: 'labels', languages: 'en', format: 'json', origin: '*'
    });
    const data = await fetchJson(WD_API + '?' + params, signal);
    Object.entries(data.entities || {}).forEach(([id, entity]) => {
      const label = entity && entity.labels && entity.labels.en && entity.labels.en.value;
      labelCache.set(id, label || null);
    });
  }

  list.forEach(id => out.set(id, labelCache.has(id) ? labelCache.get(id) : null));
  return out;
}

/* --------------------------------------------------------------------------
   "Is this a settlement?"

   Start from P31 (instance of). If none of those are known settlement roots,
   walk P279 (subclass of) upward a few hops. Everything is batched and
   cached, and the taxonomy nodes repeat heavily across cities, so in practice
   this settles in zero or one extra request.
   -------------------------------------------------------------------------- */

const settlementCache = new Map();   // entity Q-ID -> boolean
const parentCache     = new Map();   // class Q-ID  -> parent class Q-IDs
const labelCache      = new Map();   // entity Q-ID -> label string | null

export function _resetCaches() {
  settlementCache.clear();
  parentCache.clear();
  labelCache.clear();
  entityClaimsCache.clear();
}

export async function classifySettlements(qids, signal) {
  const result = new Map();
  const pending = [];

  for (const q of new Set(qids)) {
    if (settlementCache.has(q)) result.set(q, settlementCache.get(q));
    else pending.push(q);
  }
  if (!pending.length) return result;

  const decide = (qid, verdict) => {
    settlementCache.set(qid, verdict);
    result.set(qid, verdict);
  };

  const entities = await fetchEntities(pending, signal);
  const frontier = new Map();          // qid -> Set of class IDs still to explore

  for (const qid of pending) {
    const p31 = claimIds(entities.get(qid), 'P31');
    if (!p31.length)                          decide(qid, false);
    else if (p31.some(c => SETTLEMENT_ROOTS.has(c))) decide(qid, true);
    else frontier.set(qid, new Set(p31));
  }

  const seen = new Map();              // qid -> classes already expanded
  frontier.forEach((set, qid) => seen.set(qid, new Set(set)));

  for (let hop = 0; hop < MAX_SUBCLASS_HOPS && frontier.size; hop++) {
    const need = new Set();
    frontier.forEach(set => set.forEach(c => { if (!parentCache.has(c)) need.add(c); }));

    if (need.size) {
      const classEntities = await fetchEntities([...need], signal);
      need.forEach(c => parentCache.set(c, claimIds(classEntities.get(c), 'P279')));
    }

    for (const [qid, set] of [...frontier]) {
      const next = new Set();
      set.forEach(c => (parentCache.get(c) || []).forEach(p => {
        if (!seen.get(qid).has(p)) { next.add(p); seen.get(qid).add(p); }
      }));

      if ([...next].some(c => SETTLEMENT_ROOTS.has(c))) {
        decide(qid, true);  frontier.delete(qid);
      } else if (!next.size) {
        decide(qid, false); frontier.delete(qid);
      } else {
        frontier.set(qid, next);
      }
    }
  }

  frontier.forEach((_set, qid) => decide(qid, false));
  return result;
}

/* --------------------------------------------------------------------------
   Public helpers used by the app
   -------------------------------------------------------------------------- */

async function resolveQid(title, signal) {
  const qids = await fetchQids([title], signal);
  return qids.get(title) || null;
}

/**
 * Is this summary payload a place?
 * Returns true / false, or null when Wikidata could not be consulted —
 * the caller then falls back to a weaker signal rather than guessing.
 */
export async function isSettlementTitle(title, signal) {
  const qid = await resolveQid(title, signal);
  if (!qid) return null;
  const verdict = await classifySettlements([qid], signal);
  return verdict.has(qid) ? verdict.get(qid) : null;
}

/**
 * Same classification as isSettlementTitle, but also hands back the
 * resolved Q-ID so the caller can look up facts for it without a second
 * title -> Q-ID round trip.
 */
export async function classifyTitle(title, signal) {
  const qid = await resolveQid(title, signal);
  if (!qid) return { qid: null, isCity: null };
  const verdict = await classifySettlements([qid], signal);
  return { qid, isCity: verdict.has(qid) ? verdict.get(qid) : null };
}

/** Keep only the search hits that classify as settlements. */
export async function filterToSettlements(hits, signal) {
  if (!hits.length) return [];
  const titles = hits.map(h => h.title);
  const qidByTitle = await fetchQids(titles, signal);
  const verdicts = await classifySettlements([...qidByTitle.values()], signal);
  return hits.filter(h => {
    const qid = qidByTitle.get(h.title);
    return qid ? verdicts.get(qid) === true : false;
  });
}

/* --------------------------------------------------------------------------
   Key facts (population, country, area, elevation, timezone)

   Area/elevation units are mapped through a small static table rather than
   fetched as labels: Wikidata uses a fixed, tiny set of units for these
   properties, and their labels are full words ("square kilometre") rather
   than the symbol we want to show. An unrecognized unit means the field is
   omitted entirely — a bare number with no unit would be misleading.
   -------------------------------------------------------------------------- */

const UNIT_ABBR = {
  Q712226:  'km²',  // square kilometre
  Q35852:   'ha',   // hectare
  Q2737347: 'mi²',  // square mile
  Q11573:   'm',    // metre
  Q3710:    'ft'    // foot
};

/**
 * Population, country, area, elevation and timezone for a Wikidata entity.
 * All fields are independently nullable — a partial or empty result is
 * expected and valid; the caller renders only what's present.
 */
export async function fetchFacts(qid, signal) {
  const claims = (await fetchEntities([qid], signal)).get(qid) || {};

  const population  = claimQuantity(claims, 'P1082');
  const area        = claimQuantity(claims, 'P2046');
  const elevation   = claimQuantity(claims, 'P2044');
  const countryQid  = claimId(claims, 'P17');
  const timezoneQid = claimId(claims, 'P421');

  const labelQids = [countryQid, timezoneQid].filter(Boolean);
  const labels = labelQids.length ? await fetchLabels(labelQids, signal) : new Map();

  const withUnit = q => {
    const abbr = q && UNIT_ABBR[q.unitQid];
    return abbr ? { value: q.amount, unit: abbr } : null;
  };

  return {
    population: population ? Math.round(population.amount) : null,
    country:    countryQid  ? (labels.get(countryQid)  || null) : null,
    area:       withUnit(area),
    elevation:  withUnit(elevation),
    timezone:   timezoneQid ? (labels.get(timezoneQid) || null) : null
  };
}
