import {
  installDom, installFetch, tick, loadApp, installFakeLeaflet, installFakeMatchMedia
} from './harness.js';
import { makeWorld } from './world.js';

let pass = 0, fail = 0;
const group = n => console.log('\n' + n);
const check = (name, cond, extra) => {
  if (cond) { console.log('  PASS  ' + name); pass++; }
  else { console.log('  FAIL  ' + name + (extra ? '\n        ' + String(extra).slice(0, 300) : '')); fail++; }
};

const settle = () => tick(40);

async function boot({ search = '', world = makeWorld() } = {}) {
  const dom = installDom({ search });
  const calls = installFetch(world);
  const app = await loadApp();
  return { ...dom, calls, app, world };
}
const submit = (els, value) => {
  els['city-input'].value = value;
  els['search-form'].dispatch('submit', { preventDefault() {} });
};

/* ========================================================================== */

group('1. Pure helpers (wiki.js)');
{
  const { stripTags, claimIds, claimId, claimQuantity } = await import('../js/wiki.js');

  check('stripTags removes markup',
    stripTags('<span class="searchmatch">Lisbon</span> is') === 'Lisbon is');
  check('stripTags decodes entities',
    stripTags('caf&amp;eacute; &quot;X&quot;').includes('"X"'));

  const claims = { P31: [
    { rank: 'normal',     mainsnak: { snaktype: 'value',   datavalue: { value: { id: 'Q515' } } } },
    { rank: 'deprecated', mainsnak: { snaktype: 'value',   datavalue: { value: { id: 'Q999' } } } },
    { rank: 'normal',     mainsnak: { snaktype: 'novalue' } },
    { rank: 'normal' },
    null
  ]};
  const ids = claimIds(claims, 'P31');
  check('claimIds keeps normal-rank values', ids.includes('Q515'));
  check('claimIds drops deprecated', !ids.includes('Q999'));
  check('claimIds survives novalue / missing snaks', ids.length === 1, JSON.stringify(ids));
  check('claimIds on missing property returns []', claimIds({}, 'P31').length === 0);
  check('claimIds on undefined claims returns []', claimIds(undefined, 'P31').length === 0);

  const claimsP17 = { P17: [
    { rank: 'normal', mainsnak: { snaktype: 'value', datavalue: { value: { id: 'Q45' } } } }
  ]};
  check('claimId returns the entity id', claimId(claimsP17, 'P17') === 'Q45');
  check('claimId on missing property returns null', claimId({}, 'P17') === null);

  const claimsQty = { P1082: [
    { rank: 'deprecated', mainsnak: { snaktype: 'value', datavalue: { value: { amount: '+999', unit: '1' } } } },
    { rank: 'normal',     mainsnak: { snaktype: 'value', datavalue: { value: { amount: '+506654', unit: '1' } } } },
    { rank: 'preferred',  mainsnak: { snaktype: 'value', datavalue: { value: { amount: '+520000', unit: '1' } } },
      qualifiers: { P585: [{ snaktype: 'value', datavalue: { value: { time: '+2021-00-00T00:00:00Z' } } }] } }
  ]};
  const qty = claimQuantity(claimsQty, 'P1082');
  check('claimQuantity prefers the preferred-rank statement', qty.amount === 520000, qty.amount);
  check('claimQuantity ignores deprecated statements over normal/preferred ones', qty.amount !== 999);
  check('claimQuantity treats unit "1" as dimensionless', qty.unitQid === null);
  check('claimQuantity reads the point-in-time qualifier as a year', qty.year === 2021, qty.year);
  check('claimQuantity on missing property returns null', claimQuantity({}, 'P1082') === null);

  const claimsQtyNoYear = { P1082: [
    { rank: 'normal', mainsnak: { snaktype: 'value', datavalue: { value: { amount: '+254436', unit: '1' } } } }
  ]};
  check('claimQuantity year is null when there is no qualifier',
    claimQuantity(claimsQtyNoYear, 'P1082').year === null);

  const claimsArea = { P2046: [
    { rank: 'normal', mainsnak: { snaktype: 'value', datavalue: {
      value: { amount: '+100.05', unit: 'http://www.wikidata.org/entity/Q712226' } } } }
  ]};
  const area = claimQuantity(claimsArea, 'P2046');
  check('claimQuantity extracts the unit Q-ID off the entity URI', area.unitQid === 'Q712226', area.unitQid);
  check('claimQuantity parses the amount as a number', area.amount === 100.05, area.amount);
}

/* ========================================================================== */

group('2. Settlement classification');
{
  const world = makeWorld();
  installDom(); const calls = installFetch(world);
  const wiki = await import('../js/wiki.js');
  wiki._resetCaches();

  const direct = await wiki.classifySettlements(['Q597']);
  check('city matches at depth 0 (Lisbon)', direct.get('Q597') === true);
  check('depth-0 match costs one request', calls.length === 1, 'calls=' + calls.length);

  wiki._resetCaches();
  const hop = await wiki.classifySettlements(['Q1479']);
  check('commune of France resolves via subclass walk (Bordeaux)', hop.get('Q1479') === true);

  wiki._resetCaches();
  const cityState = await wiki.classifySettlements(['Q334']);
  check('city-state counts as a city (Singapore)', cityState.get('Q334') === true);

  wiki._resetCaches();
  const mixed = await wiki.classifySettlements(['Q251', 'Q3757', 'Q39231']);
  check('programming language rejected', mixed.get('Q251') === false);
  check('island rejected', mixed.get('Q3757') === false);
  check('mountain rejected', mixed.get('Q39231') === false);

  wiki._resetCaches();
  const before = calls.length;
  await wiki.classifySettlements(['Q597', 'Q36433', 'Q3630']);
  const batched = calls.length - before;
  check('three cities resolve in one batched request', batched === 1, 'requests=' + batched);

  const after = calls.length;
  await wiki.classifySettlements(['Q597', 'Q36433']);
  check('repeat classification hits cache (no network)', calls.length === after);
}

/* ========================================================================== */

group('3. Title -> Q-ID mapping');
{
  const world = makeWorld();
  installDom(); installFetch(world);
  const wiki = await import('../js/wiki.js');
  wiki._resetCaches();

  const map = await wiki.fetchQids(['Lisbon', 'Porto']);
  check('maps plain titles', map.get('Lisbon') === 'Q597' && map.get('Porto') === 'Q36433');

  const norm = await wiki.fetchQids(['lisbon']);
  check('follows normalisation (lisbon -> Lisbon)', norm.get('lisbon') === 'Q597');

  const missing = await wiki.fetchQids(['Nonexistent Place']);
  check('unknown title yields no entry', !missing.has('Nonexistent Place'));
}

/* ========================================================================== */

group('4. Key facts (wiki.js)');
{
  const world = makeWorld();
  installDom(); const calls = installFetch(world);
  const wiki = await import('../js/wiki.js');
  wiki._resetCaches();

  const lisbon = await wiki.fetchFacts('Q597');
  check('population extracted', lisbon.population === 506654, lisbon.population);
  check('population year extracted', lisbon.populationYear === 2021, lisbon.populationYear);
  check('country label resolved', lisbon.country === 'Portugal', lisbon.country);
  check('area value + unit resolved',
    lisbon.area && lisbon.area.value === 100.05 && lisbon.area.unit === 'km²',
    JSON.stringify(lisbon.area));
  check('elevation value + unit resolved',
    lisbon.elevation && lisbon.elevation.value === 2 && lisbon.elevation.unit === 'm',
    JSON.stringify(lisbon.elevation));
  check('timezone label resolved', lisbon.timezone === 'Western European Time', lisbon.timezone);

  wiki._resetCaches();
  const porto = await wiki.fetchFacts('Q36433');
  check('city with no Wikidata facts returns all fields null',
    porto.population === null && porto.populationYear === null && porto.country === null &&
    porto.area === null && porto.elevation === null && porto.timezone === null,
    JSON.stringify(porto));

  wiki._resetCaches();
  const bordeaux = await wiki.fetchFacts('Q1479');
  check('partial facts: population present', bordeaux.population === 254436, bordeaux.population);
  check('partial facts: population year absent stays null (no qualifier in fixture)',
    bordeaux.populationYear === null, bordeaux.populationYear);
  check('partial facts: country present', bordeaux.country === 'France', bordeaux.country);
  check('partial facts: timezone absent stays null', bordeaux.timezone === null, bordeaux.timezone);

  wiki._resetCaches();
  const unrecognized = await wiki.fetchFacts('Q999999');
  check('unrecognized unit is omitted rather than shown as a bare number',
    unrecognized.area === null, JSON.stringify(unrecognized));

  wiki._resetCaches();
  await wiki.classifySettlements(['Q597']);
  const before = calls.length;
  await wiki.fetchFacts('Q597');
  const extra = calls.length - before;
  check('facts reuse the entity-claims cache from classification (only a labels request)',
    extra === 1, 'extra requests=' + extra);
}

/* ========================================================================== */

group('5. A real city renders');
{
  const { els } = await boot();
  submit(els, 'Lisbon');
  await settle();

  const out = els['results'].textContent;
  check('title shown', out.includes('Lisbon'));
  check('extract shown', out.includes('largest city of Portugal'));
  check('coords formatted', out.includes('38.722') && out.includes('W'), out);
  check('source link present',
    els['results'].findAll('a').some(a => a.getAttribute('href')?.includes('/wiki/Lisbon')));
  check('no "doesn\u2019t look like a city" warning', !out.includes('look like a city'));
}

/* ========================================================================== */

group('6. Non-city is rejected and alternatives offered');
{
  const { els } = await boot();
  submit(els, 'Java');
  await settle();

  const out = els['results'].textContent;
  check('rejects the programming language', out.includes('look like a city'), out);

  const options = els['results'].byClass('option-link').map(b => b.textContent);
  check('offers Jakarta', options.includes('Jakarta'), JSON.stringify(options));
  check('does not offer the language', !options.includes('Java (programming language)'),
    JSON.stringify(options));
  check('does not offer the island', !options.includes('Java'), JSON.stringify(options));
  check('no override to view the rejected article', els['results'].byClass('override').length === 0);
}

/* ========================================================================== */

group('7. Coordinates alone would have been wrong (Mount Fuji)');
{
  const { els } = await boot();
  submit(els, 'Mount Fuji');
  await settle();
  const out = els['results'].textContent;
  check('mountain rejected despite having coordinates', out.includes('look like a city'), out);
  check('nearby city offered instead',
    els['results'].byClass('option-link').some(b => b.textContent === 'Fujinomiya'));
}

/* ========================================================================== */

group('8. Disambiguation pages');
{
  const { els } = await boot();
  submit(els, 'Springfield');
  await settle();
  const out = els['results'].textContent;
  check('disambiguation detected', out.includes('Several places share that name'), out);
  const options = els['results'].byClass('option-link').map(b => b.textContent);
  check('lists the real Springfields', options.includes('Springfield, Massachusetts') &&
    options.includes('Springfield, Illinois'), JSON.stringify(options));
  check('filters out the fictional one',
    !options.includes('Springfield (The Simpsons)'), JSON.stringify(options));
}

/* ========================================================================== */

group('9. 404 with no city matches');
{
  const { els } = await boot();
  submit(els, 'Zzzqqq');
  await settle();
  const out = els['results'].textContent;
  check('shows "No article found"', out.includes('No article found'), out);
  check('explains the miss', out.includes('Nothing matched') || out.includes('No towns or cities'), out);
}

/* ========================================================================== */

group('10. Shareable ?city= URLs');
{
  const { els, loc, historyLog, doc } = await boot();
  submit(els, 'Lisbon');
  await settle();

  check('URL updated', loc.search === '?city=Lisbon', loc.search);
  check('history entry pushed, not replaced', historyLog.at(-1).type === 'push');
  check('document title updated', doc.title.startsWith('Lisbon \u2014 Urban\u00ecta'), doc.title);

  submit(els, 'Porto');
  await settle();
  check('second search pushes again', historyLog.filter(h => h.type === 'push').length === 2);
  check('URL now Porto', loc.search === '?city=Porto', loc.search);
}

group('11. Deep link on first load');
{
  const { els, calls } = await boot({ search: '?city=Kyoto' });
  await tick(3);
  check('lookup fired from URL', calls.some(u => u.includes('summary/Kyoto')), calls[0]);
  check('input prefilled', els['city-input'].value === 'Kyoto', els['city-input'].value);
}

group('12. Back button');
{
  const { els, win, historyLog } = await boot();
  submit(els, 'Lisbon');
  await settle();
  submit(els, 'Porto');
  await settle();

  const pushesBefore = historyLog.filter(h => h.type === 'push').length;
  win.dispatch('popstate', { state: { city: 'Lisbon' } });
  await settle();

  check('renders the previous city', els['results'].textContent.includes('Lisbon'));
  check('popstate does not push a new entry',
    historyLog.filter(h => h.type === 'push').length === pushesBefore);
}

/* ========================================================================== */

group('13. Picking an alternative loads it');
{
  const { els, loc } = await boot();
  submit(els, 'Java');
  await settle();
  els['results'].byClass('option-link').find(b => b.textContent === 'Jakarta').click();
  await settle();
  check('Jakarta rendered', els['results'].textContent.includes('capital of Indonesia'),
    els['results'].textContent);
  check('URL follows the pick', loc.search === '?city=Jakarta', loc.search);
}

/* ========================================================================== */

group('14. Race condition');
{
  const world = makeWorld(); world.delay = 20;
  const { els } = await boot({ world });
  submit(els, 'Lisbon');
  await tick(1);
  submit(els, 'Porto');
  await new Promise(r => setTimeout(r, 120));
  await settle();
  const out = els['results'].textContent;
  check('shows Porto', out.includes('Porto is a city'), out);
  check('stale Lisbon response discarded', !out.includes('largest city of Portugal'), out);
}

/* ========================================================================== */

group('15. Wikidata unreachable: degrade, do not block');
{
  const world = makeWorld();
  world.down = /wikidata\.org/;
  const { els } = await boot({ world });
  submit(els, 'Lisbon');
  await settle();
  const out = els['results'].textContent;
  check('city still shown via coordinate fallback', out.includes('largest city of Portugal'), out);
  check('no error state', !out.includes('Something went wrong'));
}

/* ========================================================================== */

group('16. Hostile payload is never parsed as HTML');
{
  const world = makeWorld();
  world.articles['Evil'] = {
    type: 'standard', title: '<img src=x onerror=alert(1)>',
    description: '<script>alert(2)</script>', extract: 'benign',
    coordinates: { lat: 0, lon: 0 },
    content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Evil' } }
  };
  world.qids['<img src=x onerror=alert(1)>'] = 'Q597';
  const { els } = await boot({ world });
  submit(els, 'Evil');
  await settle();
  check('no <img> from payload', els['results'].findAll('img').length === 0);
  check('no <script> from payload', els['results'].findAll('script').length === 0);
  check('rendered as literal text',
    els['results'].textContent.includes('<img src=x onerror=alert(1)>'));
}

/* ========================================================================== */

group('17. Full app boot — facts render');
{
  const { els } = await boot();
  submit(els, 'Lisbon');
  await settle();

  const factsBoxes = els['results'].byClass('facts');
  check('facts box renders for Lisbon', factsBoxes.length === 1);
  const factsText = factsBoxes[0].textContent;
  check('shows population formatted with thousands separator', factsText.includes('506,654'), factsText);
  check('shows the population’s source year in parentheses',
    factsText.includes('506,654 (2021)'), factsText);
  check('shows country', factsText.includes('Portugal'), factsText);
  check('shows area with unit', factsText.includes('100.05') && factsText.includes('km²'), factsText);
  check('shows elevation with unit', factsText.includes('2 m'), factsText);
  check('shows timezone', factsText.includes('Western European Time'), factsText);

  submit(els, 'Porto');
  await settle();
  check('no facts box when Wikidata has no claims for the city',
    els['results'].byClass('facts').length === 0);
  check('map container still renders (coordinates are independent of facts)',
    els['results'].byClass('map-container').length === 1);

  submit(els, 'Bordeaux');
  await settle();
  const bordeauxBox = els['results'].byClass('facts');
  check('facts box renders with only the populated rows', bordeauxBox.length === 1);
  const dts = bordeauxBox[0].findAll('dt').map(d => d.textContent);
  check('shows Population row', dts.includes('Population'), JSON.stringify(dts));
  check('shows Country row', dts.includes('Country'), JSON.stringify(dts));
  check('omits Timezone row (no claim in fixture)', !dts.includes('Timezone'), JSON.stringify(dts));
  check('omits Area row (no claim in fixture)', !dts.includes('Area'), JSON.stringify(dts));
}

/* ========================================================================== */

group('18. Map lifecycle');
{
  /* No Leaflet loaded: container renders, nothing throws. */
  const { els } = await boot();
  submit(els, 'Lisbon');
  await settle();
  check('map container renders even without Leaflet loaded',
    els['results'].byClass('map-container').length === 1);

  /* With a fake Leaflet: instances are created and torn down across renders. */
  const world = makeWorld();
  const dom = installDom();
  const leafletInstances = installFakeLeaflet();
  const media = installFakeMatchMedia(false);
  installFetch(world);
  await loadApp();
  const els2 = dom.els;

  submit(els2, 'Lisbon');
  await settle();
  check('first search creates a map instance', leafletInstances.length === 1);
  check('first instance is not removed', leafletInstances[0].removed === false);

  submit(els2, 'Porto');
  await settle();
  check('second search creates a second instance', leafletInstances.length === 2);
  check('first instance is torn down when replaced', leafletInstances[0].removed === true);
  check('second instance is left alive', leafletInstances[1].removed === false);

  submit(els2, 'Lisbon');   // cache hit
  await settle();
  check('cache-hit re-render creates a fresh map instance without a new claims fetch',
    leafletInstances.length === 3 && leafletInstances[1].removed === true);

  dom.win.dispatch('popstate', { state: { city: 'Porto' } });
  await settle();
  check('back button reattaches a map for the restored city',
    leafletInstances.length === 4 && leafletInstances[2].removed === true);

  check('a theme-change listener was registered for the live map', media.listenerCount() === 1);
  media.setDark(true);
  check('flipping the OS theme does not throw or remove the live map',
    leafletInstances[3].removed === false);
}

/* ========================================================================== */

group('19. Light/dark switch');
{
  const world = makeWorld();
  const dom = installDom();
  const leafletInstances = installFakeLeaflet();
  installFakeMatchMedia(false);   // OS prefers light
  installFetch(world);
  await loadApp();
  const els = dom.els;
  const toggle = els['theme-toggle'];

  check('starts unpressed, offers to switch to dark',
    toggle.getAttribute('aria-pressed') === 'false' && toggle.textContent.includes('Dark'),
    toggle.textContent);

  submit(els, 'Lisbon');
  await settle();
  check('map attaches with light tiles, matching the OS',
    leafletInstances[0].tileUrl.includes('light_all'), leafletInstances[0].tileUrl);

  toggle.click();
  check('data-theme set to dark', dom.doc.documentElement.dataset.theme === 'dark');
  check('persisted to localStorage', dom.localStorage.getItem('urbanita-theme') === 'dark');
  check('button flips: pressed, now offers light',
    toggle.getAttribute('aria-pressed') === 'true' && toggle.textContent.includes('Light'),
    toggle.textContent);
  check('the live map swaps to dark tiles immediately',
    leafletInstances[0].tileUrl.includes('dark_all'), leafletInstances[0].tileUrl);

  /* Both theme-color metas take the chosen colour, not just the one whose
     media query happens to match: a manual choice is exactly the case those
     queries can't see, so whichever the browser picks has to agree with the
     page. */
  check('both theme-color metas follow the manual choice to dark',
    dom.metas.every(m => m.getAttribute('content') === '#27161e'),
    dom.metas.map(m => m.getAttribute('content')).join(' '));

  toggle.click();
  check('toggling back sets light', dom.doc.documentElement.dataset.theme === 'light');
  check('persisted', dom.localStorage.getItem('urbanita-theme') === 'light');
  check('the live map swaps back to light tiles',
    leafletInstances[0].tileUrl.includes('light_all'), leafletInstances[0].tileUrl);
  check('and the metas follow it back',
    dom.metas.every(m => m.getAttribute('content') === '#fdeeed'),
    dom.metas.map(m => m.getAttribute('content')).join(' '));
}

/* ========================================================================== */

group('19b. A remembered choice reaches the theme-color metas on load');
{
  /* The inline <head> script applies a saved choice before first paint, but
     deliberately touches nothing except the attribute — so on a page loaded
     under an OS that disagrees, the metas start on the OS's colour and
     js/theme.js has to catch them up without anyone clicking anything. */
  const dom = installDom();
  installFakeLeaflet();
  installFakeMatchMedia(false);               // OS prefers light
  installFetch(makeWorld());
  dom.doc.documentElement.setAttribute('data-theme', 'dark');   // what the inline script did
  await loadApp();

  check('the saved dark choice is pushed to both metas at startup',
    dom.metas.every(m => m.getAttribute('content') === '#27161e'),
    dom.metas.map(m => m.getAttribute('content')).join(' '));
}

/* ========================================================================== */

group('19c. Left alone when there is no manual choice');
{
  /* No saved choice means the metas' own media queries are already right,
     and pinning them to today's OS setting would stop them tracking it. */
  const dom = installDom();
  installFakeLeaflet();
  installFakeMatchMedia(true);                // OS prefers dark
  installFetch(makeWorld());
  await loadApp();

  check('the metas keep their media-scoped defaults',
    dom.metas.map(m => m.getAttribute('content')).join(' ') === '#fdeeed #27161e',
    dom.metas.map(m => m.getAttribute('content')).join(' '));
}

/* ========================================================================== */

group('20. A manual theme choice overrides the OS, in both directions');
{
  const world = makeWorld();
  const dom = installDom();
  const leafletInstances = installFakeLeaflet();
  const media = installFakeMatchMedia(true);   // OS prefers dark
  installFetch(world);
  await loadApp();
  const els = dom.els;

  submit(els, 'Lisbon');
  await settle();
  check('OS dark: map defaults to dark tiles',
    leafletInstances[0].tileUrl.includes('dark_all'), leafletInstances[0].tileUrl);

  els['theme-toggle'].click();   // force light despite the OS being dark
  check('forcing light overrides an OS set to dark',
    leafletInstances[0].tileUrl.includes('light_all'), leafletInstances[0].tileUrl);

  media.setDark(false);
  check('OS flipping to light while already forced light: stays light',
    leafletInstances[0].tileUrl.includes('light_all'), leafletInstances[0].tileUrl);

  media.setDark(true);
  check('OS flipping back to dark does not override the manual light choice',
    leafletInstances[0].tileUrl.includes('light_all'), leafletInstances[0].tileUrl);
}

/* ========================================================================== */

group('21. Random city button');
{
  const { els, loc } = await boot();
  els['random-btn'].click();
  await settle();
  check('renders a city (default fixture: Lisbon)',
    els['results'].textContent.includes('largest city of Portugal'), els['results'].textContent);
  check('URL follows the random pick', loc.search === '?city=Lisbon', loc.search);
  check('search box is cleared, not left showing a title', els['city-input'].value === '');
}

group('22. Random city retries past bad picks');
{
  const world = makeWorld();
  // empty binding, WDQS hiccup, a non-city (rejected by resolveCity), then a hit.
  world.randomQueue = [null, 'ERROR', 'Java', 'Lisbon'];
  const { els } = await boot({ world });
  els['random-btn'].click();
  await settle();
  check('eventually renders the first valid city',
    els['results'].textContent.includes('largest city of Portugal'), els['results'].textContent);
  check('does not surface the intermediate failures as an error',
    !els['results'].textContent.includes('Something went wrong'));
}

group('23. Random city gives up after exhausting attempts');
{
  const world = makeWorld();
  world.randomQueue = [null, null, null, null, null];   // RANDOM_ATTEMPTS = 5
  const { els } = await boot({ world });
  els['random-btn'].click();
  await settle();
  check('shows a dedicated error state',
    els['results'].textContent.includes('Couldn’t find a random city'), els['results'].textContent);
}

group('24. Random city aborts an in-flight manual search');
{
  const world = makeWorld(); world.delay = 20;
  const { els } = await boot({ world });
  submit(els, 'Porto');
  await tick(1);
  els['random-btn'].click();
  // The winning pick (Lisbon, via the random-queue fallback) resolves through
  // more sequential legs than most fixtures — title, classify, facts labels,
  // and now news — so needs more real-time headroom than a bare city lookup.
  await new Promise(r => setTimeout(r, 220));
  await settle();
  const out = els['results'].textContent;
  check('shows the random pick', out.includes('largest city of Portugal'), out);
  check('stale Porto response discarded', !out.includes('Porto is a city'), out);
}

/* ========================================================================== */

group('25. City news (proxy)');
{
  const world = makeWorld();
  installDom(); const calls = installFetch(world);
  const { fetchCityNews } = await import('../js/news.js');

  const lisbon = await fetchCityNews('Lisbon', 'Portugal');
  check('passes through the proxy’s articles unchanged',
    lisbon.length === 2 && lisbon[0].title === 'Lisbon hosts a design festival',
    JSON.stringify(lisbon));
  check('calls the proxy with the city as a query param',
    calls.some(u => u.includes('city=Lisbon')), JSON.stringify(calls));
  check('calls the proxy with the country as a query param',
    calls.some(u => u.includes('country=Portugal')), JSON.stringify(calls));

  const bordeaux = await fetchCityNews('Bordeaux', 'France');
  check('a fixture with zero articles yields an empty array, not an error',
    Array.isArray(bordeaux) && bordeaux.length === 0);

  const noFixture = await fetchCityNews('Nowhereville', null);
  check('a city with no fixture entry also yields an empty array', noFixture.length === 0);
}

/* ========================================================================== */

group('26. Full app boot — news renders');
{
  const { els } = await boot();
  submit(els, 'Lisbon');
  await settle();

  const newsBoxes = els['results'].byClass('news');
  check('news section renders for Lisbon', newsBoxes.length === 1);
  const links = newsBoxes[0].findAll('a');
  check('shows both fixture headlines', links.length === 2, links.length);
  check('each headline links out to its own source article',
    links.every(a => (a.getAttribute('href') || '').startsWith('http')),
    JSON.stringify(links.map(a => a.getAttribute('href'))));
  check('shows the source domain', newsBoxes[0].textContent.includes('example.com'),
    newsBoxes[0].textContent);

  submit(els, 'Bordeaux');
  await settle();
  check('no news section when there is no recent coverage (no empty box)',
    els['results'].byClass('news').length === 0);
}

/* ========================================================================== */

group('27. News proxy unreachable: degrade, do not block');
{
  const world = makeWorld();
  world.newsProxyDown = true;
  const { els } = await boot({ world });
  submit(els, 'Lisbon');
  await settle();
  const out = els['results'].textContent;
  check('city still shown when the news proxy is down', out.includes('largest city of Portugal'), out);
  check('facts still shown when the news proxy is down', out.includes('506,654'), out);
  check('no error state', !out.includes('Something went wrong'));
  check('no news section rendered', els['results'].byClass('news').length === 0);
}

/* ========================================================================== */

group('28. Films (films.js)');
{
  const { fetchCityFilms } = await import('../js/films.js');
  const world = makeWorld();
  installDom();
  installFetch(world);

  check('no QID means no query at all', (await fetchCityFilms(null)).length === 0);

  const films = await fetchCityFilms('Q597');
  check('returns the fixture films', films.length === 3, films.length);
  check('strips the "(film)" disambiguator',
    films[0].title === 'Night Train to Lisbon', films[0].title);
  check('strips the "(2009 film)" disambiguator',
    films[2].title === 'Alive', films[2].title);
  check('keeps the year', films[0].year === 2013, films[0].year);
  check('a missing year stays null', films[2].year === null, films[2].year);
  check('links to the English Wikipedia article',
    films[0].url === 'https://en.wikipedia.org/wiki/Night_Train_to_Lisbon_(film)', films[0].url);

  check('a city with no films yields an empty array',
    (await fetchCityFilms('Q36433')).length === 0);

  world.films = { Q597: 'ERROR' };
  check('an unreachable endpoint yields [], not a throw',
    (await fetchCityFilms('Q597')).length === 0);
}

/* ========================================================================== */

group('29. Full app boot — films render');
{
  const { els, world } = await boot();
  submit(els, 'Lisbon');
  await settle();

  const panels = els['results'].byClass('panel--films');
  check('films panel renders for Lisbon', panels.length === 1);
  const links = panels[0].findAll('A');
  check('one link per film', links.length === 3, links.length);
  check('shows the cleaned title',
    panels[0].textContent.includes('Night Train to Lisbon'), panels[0].textContent);
  check('shows the year', panels[0].textContent.includes('2013'));
  check('the skeleton is gone once the list lands',
    panels[0].byClass('films-skeleton').length === 0);

  const before = world.filmCalls;
  submit(els, 'Porto');
  await settle();
  check('no films panel at all when the city has none (no empty box)',
    els['results'].byClass('panel--films').length === 0);
  check('a city with no films still queried once', world.filmCalls === before + 1);

  submit(els, 'Lisbon');          // cache hit
  await settle();
  check('cache hit re-renders the films without querying again',
    world.filmCalls === before + 1, world.filmCalls);
  check('films still on screen after the cache hit',
    els['results'].byClass('panel--films').length === 1);
}

/* ========================================================================== */

group('30. Films degrade without blocking the card');
{
  const world = makeWorld();
  world.films = { Q597: 'ERROR' };
  const { els } = await boot({ world });
  submit(els, 'Lisbon');
  await settle();

  const out = els['results'].textContent;
  check('city still shown when Wikidata is unreachable',
    out.includes('largest city of Portugal'), out);
  check('no error state', !out.includes('Something went wrong'));
  check('no films panel left behind', els['results'].byClass('panel--films').length === 0);
  check('the map still renders', els['results'].byClass('map-container').length === 1);
}

/* ========================================================================== */

group('31. Collage structure');
{
  const { els } = await boot();
  submit(els, 'Lisbon');
  await settle();

  const city = els['results'].byClass('city')[0];
  check('both rails render', els['results'].byClass('city-rail').length === 2);

  const card = els['results'].byClass('city-card')[0];
  check('key facts are their own card, not inside the city card',
    card.byClass('facts').length === 0 && els['results'].byClass('facts').length === 1);
  const left  = els['results'].byClass('city-rail--left')[0];
  const right = els['results'].byClass('city-rail--right')[0];
  check('facts and news sit in the left rail',
    left.byClass('city-facts').length === 1 && left.byClass('panel--news').length === 1);
  check('map and films sit in the right rail',
    right.byClass('panel--map').length === 1 && right.byClass('panel--films').length === 1);
  // The point of the split: news and films are often absent, facts and the
  // map almost never are, so each side keeps one dependable card.
  check('each rail holds one near-always-present card',
    left.byClass('city-facts').length === 1 && right.byClass('panel--map').length === 1);
  check('the source link stays in the city card (CC BY-SA attribution)',
    card.byClass('card-meta').length === 1);
  check('the city card is a direct child of .city, beside the rails',
    city.childNodes.filter(n => (n.className || '').includes('city-card')).length === 1);

  /* A city with no facts and no coordinates should not leave an empty rail
     behind for the grid to reserve a column for. */
  const world = makeWorld();
  world.articles['Nowhere'] = {
    type: 'standard', title: 'Nowhere', extract: 'A place with almost nothing recorded.',
    content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Nowhere' } }
  };
  // Q36433 (Porto's) classifies as a city but carries no facts at all in the
  // fixture world — so this article yields neither a facts box nor a map.
  world.qids['Nowhere'] = 'Q36433';
  const bare = await boot({ world });
  submit(bare.els, 'Nowhere');
  await settle();
  check('no left rail at all when there are neither facts nor news',
    bare.els['results'].byClass('city-rail--left').length === 0);
  check('the right rail survives it (films are still being fetched)',
    bare.els['results'].byClass('city-rail--right').length === 1);
}

/* ========================================================================== */

group('32. Map interaction follows the tilt');
{
  /* Wide enough to tilt: the pointer-driven handlers must be off, because
     Leaflet has no rotation support and its screen-point maths would skew. */
  const dom = installDom();
  const maps = installFakeLeaflet();
  const media = installFakeMatchMedia(false);
  installFetch(makeWorld());
  await loadApp();
  media.setMatches('(min-width: 1200px)', true);

  submit(dom.els, 'Lisbon');
  await settle();
  const map = maps[maps.length - 1];
  check('dragging is off while the card is tilted', map.dragging.enabled === false);
  check('double-click zoom is off too (it resolves a point to a latlng)',
    map.doubleClickZoom.enabled === false);
  check('a tilt listener was registered', media.listenerCount('(min-width: 1200px)') === 1);
  check('the theme listener is still separate', media.listenerCount() === 1);

  /* Narrowing below the breakpoint straightens the card, so it comes back. */
  media.setMatches('(min-width: 1200px)', false);
  check('dragging returns once the card is straight', map.dragging.enabled === true);

  /* And on a narrow screen it is never taken away in the first place. */
  const narrow = installDom();
  const narrowMaps = installFakeLeaflet();
  installFakeMatchMedia(false);
  installFetch(makeWorld());
  await loadApp();
  submit(narrow.els, 'Lisbon');
  await settle();
  check('dragging is left alone when stacked',
    narrowMaps[narrowMaps.length - 1].dragging.enabled === true);
}

/* ========================================================================== */

group('33. On touch the map gives the page its swipe back');
{
  /* A stacked map is a full-width band mid-page. With one-finger dragging on,
     a swipe that lands on the tiles pans the map instead of scrolling past
     it, and the reader is stuck. Two fingers still zoom and pan, via the
     touch-zoom handler, and the +/- buttons never depended on any of this. */
  const dom = installDom();
  const maps = installFakeLeaflet();
  const media = installFakeMatchMedia(false);
  installFetch(makeWorld());
  await loadApp();
  media.setMatches('(pointer: coarse)', true);

  submit(dom.els, 'Lisbon');
  await settle();
  const map = maps[maps.length - 1];
  check('one-finger dragging is off on a touch screen', map.dragging.enabled === false);
  check('pinch zoom still works', map.touchZoom.enabled === true);
  check('a pointer listener was registered', media.listenerCount('(pointer: coarse)') === 1);

  /* The tilt rule and the touch rule both speak for `dragging`, and the
     tilted one is stricter. Crossing the breakpoint has to leave the touch
     rule standing rather than handing dragging back on the way out. */
  media.setMatches('(min-width: 1200px)', true);
  check('tilting takes the rest away too', map.touchZoom.enabled === false);
  media.setMatches('(min-width: 1200px)', false);
  check('straightening restores pinch', map.touchZoom.enabled === true);
  check('but dragging stays off — it is still a touch screen',
    map.dragging.enabled === false);

  /* And a pointer that gains precision gets the full map back. */
  media.setMatches('(pointer: coarse)', false);
  check('dragging returns on a fine pointer', map.dragging.enabled === true);
}

/* ========================================================================== */

console.log('\n' + '-'.repeat(48));
console.log(`  ${pass} passed, ${fail} failed`);
console.log('-'.repeat(48));
process.exit(fail ? 1 : 0);
