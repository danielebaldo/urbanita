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

/** Apply and persist a theme, and let the rest of the page know. */
export function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* storage unavailable */ }
  document.dispatchEvent(new CustomEvent('urbanita:theme-change', { detail: { theme } }));
}

function syncButton(button, theme) {
  const next = theme === 'dark' ? 'light' : 'dark';
  button.textContent = next === 'dark' ? '\u{1F319} Dark mode' : '☀️ Light mode';
  button.setAttribute('aria-pressed', String(theme === 'dark'));
}

const button = document.getElementById('theme-toggle');
if (button) {
  syncButton(button, effectiveTheme());
  button.addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    setTheme(next);
    syncButton(button, next);
  });
}
