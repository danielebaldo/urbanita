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

/** Interactions that map a screen point to a lat/lng — unusable when tilted. */
const POINTER_HANDLERS = ['dragging', 'doubleClickZoom', 'touchZoom'];

let current = null;   // { map, tileLayer, mql, mqlListener, tiltMql, tiltListener } | null

function isTilted() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
    window.matchMedia(TILTED).matches;
}

function setPointerHandlers(map, enabled) {
  POINTER_HANDLERS.forEach(name => {
    const handler = map[name];
    if (!handler) return;                  // option was never enabled
    if (enabled) handler.enable();
    else handler.disable();
  });
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

/** Tear down the currently live map, if any (instance + its theme listener). */
export function detachMap() {
  if (!current) return;
  const { map, mql, mqlListener, tiltMql, tiltListener } = current;
  if (mql && mqlListener) {
    if (mql.removeEventListener) mql.removeEventListener('change', mqlListener);
    else if (mql.removeListener) mql.removeListener(mqlListener);
  }
  if (tiltMql && tiltListener) {
    if (tiltMql.removeEventListener) tiltMql.removeEventListener('change', tiltListener);
    else if (tiltMql.removeListener) tiltMql.removeListener(tiltListener);
  }
  try { map.remove(); } catch { /* container already gone */ }
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

  setPointerHandlers(map, !isTilted());

  let mql = null, mqlListener = null;
  if (typeof window.matchMedia === 'function') {
    mql = window.matchMedia('(prefers-color-scheme: dark)');
    mqlListener = () => refreshTheme();
    if (mql.addEventListener) mql.addEventListener('change', mqlListener);
    else if (mql.addListener) mql.addListener(mqlListener);
  }

  // Resizing across the breakpoint tilts or straightens the card, so the
  // handlers have to follow rather than being stranded at their init value.
  let tiltMql = null, tiltListener = null;
  if (typeof window.matchMedia === 'function') {
    tiltMql = window.matchMedia(TILTED);
    tiltListener = event => setPointerHandlers(map, !event.matches);
    if (tiltMql.addEventListener) tiltMql.addEventListener('change', tiltListener);
    else if (tiltMql.addListener) tiltMql.addListener(tiltListener);
  }

  current = { map, tileLayer, mql, mqlListener, tiltMql, tiltListener };
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
