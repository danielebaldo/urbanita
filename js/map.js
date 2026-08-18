/* ==========================================================================
   Urbanita — map lifecycle
   Owns the one third-party global (window.L / Leaflet) and its lifecycle.
   No-ops gracefully whenever Leaflet isn't available (Node tests, or a
   blocked/failed CDN load) instead of throwing.
   ========================================================================== */

const TILES = {
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap</a> contributors ' +
                 '&copy; <a href="https://carto.com/attributions" rel="noopener">CARTO</a>'
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap</a> contributors ' +
                 '&copy; <a href="https://carto.com/attributions" rel="noopener">CARTO</a>'
  }
};

/* Above this width the map card is tilted (see .city in css/style.css), and
   Leaflet cannot cope: it has no rotation support at all — `getScale()` reads
   `rect.width / offsetWidth`, and a rotated element's rect is its bounding
   box, so every pointer-to-latlng conversion comes out skewed. Dragging would
   slide against the cursor. So the interactions that convert a screen point
   to a coordinate are turned off while tilted; the +/- buttons are ordinary
   clicks and keep working. */
const TILTED = '(min-width: 1200px)';

/* Below that breakpoint the map is a full-width band in the middle of a
   scrolling page. Leaflet's one-finger drag swallows the swipe that starts
   on the tiles, so a reader trying to scroll past the map pans it instead
   and gets stuck — the touch version of the trap `scrollWheelZoom: false`
   already avoids with a wheel. So on a touch device the map takes two
   fingers: `touchZoom` moves the centre as it scales, which pans and zooms
   in one gesture, and the +/- buttons are ordinary taps either way. */
const TOUCH = '(pointer: coarse)';

/** Interactions that map a screen point to a lat/lng — unusable when tilted. */
const POINTER_HANDLERS = ['dragging', 'doubleClickZoom', 'touchZoom'];

let current = null;   // { map, tileLayer, watchers } | null

function matches(query) {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
    window.matchMedia(query).matches;
}

function isTilted() { return matches(TILTED); }
function isTouch()  { return matches(TOUCH); }

function setHandlers(map, names, enabled) {
  names.forEach(name => {
    const handler = map[name];
    if (!handler) return;                  // option was never enabled
    if (enabled) handler.enable();
    else handler.disable();
  });
}

/**
 * Point the map's interactions at whatever kind of screen it's on now.
 * Tilted: nothing pointer-driven, Leaflet can't do rotation. Touch: no
 * one-finger drag, so a swipe still scrolls the page. Otherwise: all of it.
 * Re-run rather than toggled, so resizing across the breakpoint can't strand
 * a handler at the value the other rule wanted.
 */
function applyInteractionPolicy(map) {
  const tilted = isTilted();
  setHandlers(map, POINTER_HANDLERS, !tilted);
  if (!tilted && isTouch()) setHandlers(map, ['dragging'], false);
}

/**
 * Watch a media query, returning a function that stops watching. Wraps the
 * addEventListener/addListener split for legacy Safari in one place.
 */
function watch(query, onChange) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const mql = window.matchMedia(query);
  if (mql.addEventListener) mql.addEventListener('change', onChange);
  else if (mql.addListener) mql.addListener(onChange);
  else return () => {};

  return () => {
    if (mql.removeEventListener) mql.removeEventListener('change', onChange);
    else if (mql.removeListener) mql.removeListener(onChange);
  };
}

function prefersDark() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** A manual choice from the footer's theme switch wins over the OS. */
function currentScheme() {
  const manual = typeof document !== 'undefined' && document.documentElement.dataset.theme;
  if (manual === 'light' || manual === 'dark') return manual;
  return prefersDark() ? 'dark' : 'light';
}

function addTileLayer(L, map, scheme) {
  const tiles = TILES[scheme] || TILES.light;
  return L.tileLayer(tiles.url, {
    attribution: tiles.attribution,
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map);
}

/** Tear down the currently live map, if any (instance + its media watchers). */
export function detachMap() {
  if (!current) return;
  current.watchers.forEach(stop => stop());
  try { current.map.remove(); } catch { /* container already gone */ }
  current = null;
}

/**
 * Create a Leaflet map in `container` centred on {lat, lon}, with a marker
 * and CARTO tiles matching the current colour scheme. Reacts to OS/browser
 * theme changes by swapping the tile layer live. Returns the map instance,
 * or null if Leaflet isn't loaded / no container was given.
 */
export function attachMap(container, { lat, lon } = {}) {
  detachMap();
  if (typeof window === 'undefined' || !window.L || !container) return null;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;

  const L = window.L;
  const map = L.map(container, { center: [lat, lon], zoom: 12, scrollWheelZoom: false });
  const tileLayer = addTileLayer(L, map, currentScheme());
  L.marker([lat, lon]).addTo(map);

  applyInteractionPolicy(map);

  // Resizing across the breakpoint tilts or straightens the card, and a
  // device can change its primary pointer (a tablet gaining a trackpad), so
  // the handlers follow rather than being stranded at their init value.
  const watchers = [
    watch('(prefers-color-scheme: dark)', () => refreshTheme()),
    watch(TILTED, () => applyInteractionPolicy(map)),
    watch(TOUCH, () => applyInteractionPolicy(map))
  ];

  current = { map, tileLayer, watchers };
  return map;
}

/**
 * Swap the live map's tiles to match the current scheme (manual override
 * or OS). Called on OS theme changes and whenever the footer's switch is
 * used — a no-op if no map is currently attached.
 */
export function refreshTheme() {
  if (!current || typeof window === 'undefined' || !window.L) return;
  current.map.removeLayer(current.tileLayer);
  current.tileLayer = addTileLayer(window.L, current.map, currentScheme());
}

/** Test-only: forget the current map without touching a (possibly fake) instance. */
export function _resetMapState() {
  current = null;
}
