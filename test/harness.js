/* Minimal DOM / history / fetch stubs so the browser modules run under Node. */

export class Node {
  constructor(tag) {
    this.tagName = (tag || '').toUpperCase();
    this.childNodes = [];
    this.attrs = {};
    this._text = '';
    this.className = '';
    this.listeners = {};
    this.disabled = false;
  }
  get firstChild() { return this.childNodes[0]; }
  appendChild(n) { this.childNodes.push(n); n.parentNode = this; return n; }
  removeChild(n) { this.childNodes = this.childNodes.filter(c => c !== n); return n; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  dispatch(t, ev) { (this.listeners[t] || []).forEach(f => f(ev)); }
  click() { this.dispatch('click', { target: this }); }

  /** Loose stand-in for the real DOM's attrs<->dataset mirroring. */
  get dataset() {
    const attrs = this.attrs;
    return new Proxy({}, {
      get: (_t, key) => attrs['data-' + toKebab(key)],
      set: (_t, key, value) => { attrs['data-' + toKebab(key)] = String(value); return true; }
    });
  }

  set textContent(v) { this._text = String(v); this.childNodes = []; }
  get textContent() {
    return this.childNodes.length
      ? this.childNodes.map(c => c.textContent).join('')
      : this._text;
  }

  querySelector() { return (this._btn ||= new Node('button')); }
  closest(sel) {
    const m = sel.match(/^(\w+)\[([\w-]+)[^\]]*\]$/);
    if (!m) return null;
    let n = this;
    while (n) {
      if (n.tagName === m[1].toUpperCase() && n.getAttribute(m[2]) !== null) return n;
      n = n.parentNode;
    }
    return null;
  }

  text() { return this.textContent; }
  findAll(tag) {
    const out = [];
    const walk = n => { if (n.tagName === tag.toUpperCase()) out.push(n); n.childNodes.forEach(walk); };
    walk(this);
    return out;
  }
  byClass(cls) {
    const out = [];
    const walk = n => { if ((n.className || '').split(' ').includes(cls)) out.push(n); n.childNodes.forEach(walk); };
    walk(this);
    return out;
  }
}

class TextNode extends Node {
  constructor(t) { super('#text'); this._text = t; }
  get textContent() { return this._text; }
  set textContent(v) { this._text = v; }
}

function toKebab(camel) {
  return camel.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
}

/** Fresh, isolated store per installDom() call — one "browser tab" per test. */
function makeFakeStorage() {
  const store = new Map();
  return {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear()
  };
}

/* -------------------------------------------------------------------------- */

export function installDom({ search = '' } = {}) {
  const els = {
    'search-form': new Node('form'),
    'city-input': new Node('input'),
    'results': new Node('section'),
    'suggestions': new Node('div'),
    'random-btn': new Node('button'),
    'theme-toggle': new Node('button')
  };
  els['city-input'].value = '';

  const documentElement = new Node('html');
  const docListeners = {};
  const doc = {
    title: '',
    documentElement,
    getElementById: id => els[id] || null,
    createElement: t => new Node(t),
    createTextNode: t => new TextNode(t),
    addEventListener(t, fn) { (docListeners[t] ||= []).push(fn); },
    dispatchEvent(event) { (docListeners[event.type] || []).forEach(fn => fn(event)); return true; }
  };

  global.localStorage = makeFakeStorage();

  const loc = { pathname: '/', search };
  const historyLog = [];
  const hist = {
    pushState(state, _t, url) { historyLog.push({ type: 'push', state, url }); applyUrl(url); },
    replaceState(state, _t, url) { historyLog.push({ type: 'replace', state, url }); applyUrl(url); }
  };
  function applyUrl(url) {
    const i = String(url).indexOf('?');
    loc.pathname = i === -1 ? String(url) : String(url).slice(0, i);
    loc.search = i === -1 ? '' : String(url).slice(i);
  }

  const win = { listeners: {},
    addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); },
    dispatch(t, ev) { (this.listeners[t] || []).forEach(f => f(ev)); } };

  global.document = doc;
  global.location = loc;
  global.history = hist;
  global.window = win;
  delete global.window.L;
  delete global.window.matchMedia;
  global.AbortController = class {
    constructor() {
      this._l = [];
      // tolerate both addEventListener(fn) and addEventListener('abort', fn)
      const on = (a, b) => {
        const fn = typeof a === 'function' ? a : b;
        if (typeof fn === 'function') this._l.push(fn);
      };
      this.signal = { aborted: false, addEventListener: on };
    }
    abort() {
      if (this.signal.aborted) return;
      this.signal.aborted = true;
      this._l.forEach(f => f());
    }
  };

  return { doc, els, loc, hist, win, historyLog, localStorage: global.localStorage };
}

/* --------------------------------------------------------------------------
   Fake Leaflet — records created/removed map instances for lifecycle tests.
   -------------------------------------------------------------------------- */

export function installFakeLeaflet() {
  const instances = [];

  class FakeLayer {
    addTo(map) { this.map = map; map.layers.push(this); return this; }
  }

  class FakeMap {
    constructor(container, opts) {
      this.container = container;
      this.opts = opts;
      this.layers = [];
      this.removed = false;
      instances.push(this);
    }
    removeLayer(layer) { this.layers = this.layers.filter(l => l !== layer); return this; }
    remove() { this.removed = true; }
    /** Test helper: whichever tile layer (has a .url) is currently on the map. */
    get tileUrl() { return (this.layers.find(l => l.url) || {}).url; }
  }

  global.window.L = {
    map: (container, opts) => new FakeMap(container, opts),
    tileLayer: (url) => { const l = new FakeLayer(); l.url = url; return l; },
    marker: () => new FakeLayer()
  };

  return instances;
}

/* --------------------------------------------------------------------------
   Fake matchMedia — lets tests drive the dark/light tile-swap listener.
   -------------------------------------------------------------------------- */

export function installFakeMatchMedia(initialDark = false) {
  const listeners = [];
  let matches = initialDark;

  const mql = {
    get matches() { return matches; },
    addEventListener(type, fn) { if (type === 'change') listeners.push(fn); },
    removeEventListener(type, fn) {
      if (type !== 'change') return;
      const i = listeners.indexOf(fn);
      if (i !== -1) listeners.splice(i, 1);
    },
    addListener(fn) { listeners.push(fn); },              // legacy Safari API
    removeListener(fn) {
      const i = listeners.indexOf(fn);
      if (i !== -1) listeners.splice(i, 1);
    }
  };

  global.window.matchMedia = () => mql;

  return {
    setDark(value) { matches = value; listeners.slice().forEach(fn => fn({ matches: value })); },
    listenerCount: () => listeners.length
  };
}

/* --------------------------------------------------------------------------
   Fake Wikipedia + Wikidata
   -------------------------------------------------------------------------- */

export function installFetch(world) {
  const calls = [];

  global.fetch = (url, opts) => {
    calls.push(url);
    const signal = opts && opts.signal;

    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        const e = new Error('aborted'); e.name = 'AbortError'; return reject(e);
      }
      if (signal) signal.addEventListener(() => {
        const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
      });

      const done = () => {
        try { resolve(route(url, world)); }
        catch (e) { reject(e); }
      };
      if (world.delay) setTimeout(done, world.delay); else setImmediate(done);
    });
  };

  return calls;
}

function json(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

function route(url, world) {
  const u = new URL(url);

  if (world.down && world.down.test(url)) throw new Error('network down');

  /* WDQS — random city sampling. world.randomQueue is drained front-to-back,
     one entry per fetchRandomCityTitle() call: a title string, null (sampled
     entity had no enwiki article), or 'ERROR' (endpoint hiccup). Falls back
     to world.randomCityTitle (default 'Lisbon') once the queue runs dry. */
  if (u.hostname === 'query.wikidata.org') {
    const queue = world.randomQueue || [];
    const next = queue.length ? queue.shift() : (world.randomCityTitle ?? 'Lisbon');
    if (next === 'ERROR') throw new Error('WDQS down');
    if (next === null) return json({ results: { bindings: [] } });
    const articleUrl = 'https://en.wikipedia.org/wiki/' + encodeURIComponent(next).replace(/%20/g, '_');
    return json({ results: { bindings: [{ article: { value: articleUrl } }] } });
  }

  /* REST summary */
  if (u.pathname.includes('/page/summary/')) {
    const title = decodeURIComponent(u.pathname.split('/page/summary/')[1]);
    const art = world.articles[title] || world.articles[world.redirects?.[title]];
    if (!art) return json({}, 404);
    return json(art);
  }

  const action = u.searchParams.get('action');

  /* Wikipedia search */
  if (action === 'query' && u.searchParams.get('list') === 'search') {
    const q = u.searchParams.get('srsearch');
    const hits = (world.search[q] || []).map(t => ({
      title: t, snippet: `<span class="searchmatch">${t}</span> snippet`
    }));
    return json({ query: { search: hits } });
  }

  /* pageprops -> wikibase_item */
  if (action === 'query' && u.searchParams.get('prop') === 'pageprops') {
    const titles = u.searchParams.get('titles').split('|');
    const pages = {}, normalized = [], redirects = [];
    titles.forEach((t, i) => {
      let target = t;
      if (world.normalized?.[t]) { normalized.push({ from: t, to: world.normalized[t] }); target = world.normalized[t]; }
      if (world.redirects?.[target]) { redirects.push({ from: target, to: world.redirects[target] }); target = world.redirects[target]; }
      const qid = world.qids[target];
      pages[String(i)] = qid
        ? { title: target, pageprops: { wikibase_item: qid } }
        : { title: target };
    });
    return json({ query: { normalized, redirects, pages } });
  }

  /* Wikidata entities */
  if (action === 'wbgetentities') {
    const ids = u.searchParams.get('ids').split('|');
    const entities = {};

    if (u.searchParams.get('props') === 'labels') {
      ids.forEach(id => {
        const label = world.labels?.[id];
        entities[id] = { id, labels: label ? { en: { language: 'en', value: label } } : {} };
      });
      return json({ entities });
    }

    ids.forEach(id => {
      const claims = {};
      const p31  = world.p31?.[id];
      const p279 = world.p279?.[id];
      const p17  = world.p17?.[id];
      const p421 = world.p421?.[id];
      if (p31)  claims.P31  = p31.map(v => statement(v));
      if (p279) claims.P279 = p279.map(v => statement(v));
      if (p17)  claims.P17  = p17.map(v => statement(v));
      if (p421) claims.P421 = p421.map(v => statement(v));

      const pop = world.p1082?.[id];
      if (pop !== undefined) claims.P1082 = [quantityStatement(pop, null, world.p1082Year?.[id])];

      const area = world.p2046?.[id];
      if (area) claims.P2046 = [quantityStatement(area.amount, area.unit)];

      const elevation = world.p2044?.[id];
      if (elevation) claims.P2044 = [quantityStatement(elevation.amount, elevation.unit)];

      entities[id] = { id, claims };
    });
    return json({ entities });
  }

  /* Urbanita's own news proxy (worker/news-proxy.js) — matched by its
     distinctive `city` query param rather than by hostname, so the mock
     keeps working once NEWS_PROXY_URL points at a real deployed Worker
     instead of the placeholder. */
  if (u.searchParams.has('city')) {
    if (world.newsProxyDown) throw new Error('news proxy down');
    const city = u.searchParams.get('city') || '';
    return json({ articles: world.news?.[city] || [] });
  }

  throw new Error('unrouted URL: ' + url);
}

function statement(v) {
  if (typeof v === 'object') return v;   // allow raw statements in fixtures
  return { rank: 'normal', mainsnak: { snaktype: 'value', datavalue: { value: { id: v } } } };
}

function quantityStatement(amount, unitQid, year) {
  const amountStr = (amount >= 0 ? '+' : '') + String(amount);
  const unit = unitQid ? `http://www.wikidata.org/entity/${unitQid}` : '1';
  const statement = {
    rank: 'normal',
    mainsnak: { snaktype: 'value', datavalue: { value: { amount: amountStr, unit } } }
  };
  if (year !== undefined) {
    statement.qualifiers = { P585: [{
      snaktype: 'value',
      datavalue: { value: { time: `+${year}-00-00T00:00:00Z` } }
    }] };
  }
  return statement;
}

/* -------------------------------------------------------------------------- */

export const tick = (n = 1) => {
  let p = Promise.resolve();
  for (let i = 0; i < n; i++) p = p.then(() => new Promise(r => setImmediate(r)));
  return p;
};

let version = 0;
export async function loadApp() {
  version += 1;
  const wiki = await import('../js/wiki.js');
  wiki._resetCaches();
  const map = await import('../js/map.js');
  map._resetMapState();
  await import(`../js/theme.js?v=${version}`);   // wires the footer toggle, matches index.html's load order
  return import(`../js/app.js?v=${version}`);
}
