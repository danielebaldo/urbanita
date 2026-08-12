/* ==========================================================================
   Urbanita — map lifecycle
   Owns the one third-party global (window.maplibregl) and a single,
   page-wide MapLibre map (a full-width strip pinned to the bottom of the
   page, not per-card). Hidden and uncreated until the first search with
   coordinates (js/app.js reveals the section, then calls initMap); from
   then on it's left running for the rest of the session — later searches
   just fly the camera to the new city and move its marker, no re-creation,
   no teardown, no per-city styling. No-ops gracefully whenever MapLibre
   isn't available (Node tests, or a blocked/failed CDN load) instead of
   throwing.
   ========================================================================== */

const STYLE_URL = 'js/map-style.json';
const MARKER_COLOR = '#b85c38';   // --terracotta

// Starting camera, the instant before the first flyTo swoops away from it —
// Rome, tilted enough for the 3D buildings to read.
const DEFAULT_VIEW = { center: [12.4964, 41.9028], zoom: 15.5, pitch: 60, bearing: -20 };
const CITY_ZOOM = 14;

let map = null;
let marker = null;

/**
 * Create the map in `container`, once — called lazily on the first search
 * that has coordinates, after the container has already been made visible.
 * Safe to call again — later calls are no-ops and just return the existing
 * instance.
 */
export function initMap(container) {
  if (map) return map;
  if (typeof window === 'undefined' || !window.maplibregl || !container) return null;

  const maplibregl = window.maplibregl;
  map = new maplibregl.Map({
    container,
    style: STYLE_URL,
    center: DEFAULT_VIEW.center,
    zoom: DEFAULT_VIEW.zoom,
    pitch: DEFAULT_VIEW.pitch,
    bearing: DEFAULT_VIEW.bearing,
    fadeDuration: 120,   // snappier once tiles do land, instead of a slow crossfade
    attributionControl: { compact: true }
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');

  // A city's exact-zoom tiles (especially the 3D buildings, the heaviest
  // layer) are data the browser has never fetched before, so there's a
  // genuine network-bound gap after a flyTo lands. `idle` only fires once
  // the camera has stopped *and* everything currently needed has rendered
  // — so this class marks a real gap, not a guessed timeout — and it's
  // what css/style.css uses to show a brief "still filling in" cue instead
  // of a silent, confusing pop-in.
  map.on('movestart', () => { container.className = 'is-loading'; });
  map.on('idle', () => { container.className = ''; });

  return map;
}

/** Fly the live map to {lat, lon} and drop/move a labeled marker there. */
export function showLocation({ lat, lon } = {}, label = '') {
  if (!map || typeof lat !== 'number' || typeof lon !== 'number') return;

  const maplibregl = window.maplibregl;
  if (!marker) marker = new maplibregl.Marker({ color: MARKER_COLOR });
  marker.setLngLat([lon, lat]);
  if (label) marker.setPopup(new maplibregl.Popup({ offset: 24 }).setText(label));
  marker.addTo(map);

  map.flyTo({ center: [lon, lat], zoom: CITY_ZOOM, pitch: DEFAULT_VIEW.pitch, essential: true });
}

/** Remove the marker (e.g. results cleared) without moving the camera. */
export function clearLocation() {
  if (marker) { marker.remove(); marker = null; }
}

/** Test-only: forget the current map without touching a (possibly fake) instance. */
export function _resetMapState() {
  map = null;
  marker = null;
}
