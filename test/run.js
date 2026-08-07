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
    { rank: 'preferred',  mainsnak: { snaktype: 'value', datavalue: { value: { amount: '+520000', unit: '1' } } } }
  ]};
  const qty = claimQuantity(claimsQty, 'P1082');
  check('claimQuantity prefers the preferred-rank statement', qty.amount === 520000, qty.amount);
  check('claimQuantity ignores deprecated statements over normal/preferred ones', qty.amount !== 999);
  check('claimQuantity treats unit "1" as dimensionless', qty.unitQid === null);
  check('claimQuantity on missing property returns null', claimQuantity({}, 'P1082') === null);

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
    porto.population === null && porto.country === null && porto.area === null &&
    porto.elevation === null && porto.timezone === null,
    JSON.stringify(porto));

  wiki._resetCaches();
  const bordeaux = await wiki.fetchFacts('Q1479');
  check('partial facts: population present', bordeaux.population === 254436, bordeaux.population);
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
  check('document title updated', doc.title.startsWith('Lisbon \u2014 Urbanita'), doc.title);

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

  toggle.click();
  check('toggling back sets light', dom.doc.documentElement.dataset.theme === 'light');
  check('persisted', dom.localStorage.getItem('urbanita-theme') === 'light');
  check('the live map swaps back to light tiles',
    leafletInstances[0].tileUrl.includes('light_all'), leafletInstances[0].tileUrl);
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
  await new Promise(r => setTimeout(r, 120));
  await settle();
  const out = els['results'].textContent;
  check('shows the random pick', out.includes('largest city of Portugal'), out);
  check('stale Porto response discarded', !out.includes('Porto is a city'), out);
}

/* ========================================================================== */

console.log('\n' + '-'.repeat(48));
console.log(`  ${pass} passed, ${fail} failed`);
console.log('-'.repeat(48));
process.exit(fail ? 1 : 0);
