/* ==========================================================================
   Urbanita — light/dark switch
   Owns the toggle button: persists the choice, sets the <html> attribute
   the CSS keys off, and tells anyone else interested (the map) that the
   theme changed, without needing to know they exist.
   ========================================================================== */

const STORAGE_KEY = 'urbanita-theme';

/** The theme actually in effect right now: a manual choice, or the OS's. */
export function effectiveTheme() {
  const manual = document.documentElement.dataset.theme;
  if (manual === 'light' || manual === 'dark') return manual;
  return (typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}

/* The two --paper values, for the <meta name="theme-color"> pair that tints
   a mobile browser's address bar. Those metas are media-scoped, so they
   follow the OS on their own; a manual choice is the case they can't see,
   and the fix is to write the chosen colour into both — whichever one the
   browser picks then agrees with the page. Literal hexes because a meta tag
   can't hold a var(). */
const THEME_COLORS = { light: '#fdeeed', dark: '#27161e' };

function syncThemeColor(theme) {
  const color = THEME_COLORS[theme];
  if (!color) return;
  document.querySelectorAll('meta[name="theme-color"]')
    .forEach(meta => meta.setAttribute('content', color));
}

/** Apply and persist a theme, and let the rest of the page know. */
export function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  syncThemeColor(theme);
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* storage unavailable */ }
  document.dispatchEvent(new CustomEvent('urbanita:theme-change', { detail: { theme } }));
}

function syncButton(button, theme) {
  const next = theme === 'dark' ? 'light' : 'dark';
  button.textContent = next === 'dark' ? '\u{1F319} Dark mode' : '☀️ Light mode';
  button.setAttribute('aria-pressed', String(theme === 'dark'));
}

/* A choice made on an earlier visit is applied by the inline script in each
   page's <head>, before this module runs and before first paint — but that
   script deliberately touches nothing but the attribute. Where it did fire,
   the metas are still on the OS's colour and need catching up. */
if (document.documentElement.dataset.theme) syncThemeColor(effectiveTheme());

const button = document.getElementById('theme-toggle');
if (button) {
  syncButton(button, effectiveTheme());
  button.addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    setTheme(next);
    syncButton(button, next);
  });
}
