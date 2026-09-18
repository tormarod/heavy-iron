/* Runs before css/style.css can apply a single variable, so the very first
   paint uses the right palette instead of flashing light before applyTheme()
   (js/app.js, at the end of body) gets a chance to run. A real file, not an
   inline <script> in <head> where the old FOUC fix for the webfont flip
   already lives — the CSP has no room for inline scripts either way.

   Resolves "auto" into an explicit light/dark right here, the same way
   applyTheme() does from here on: css/style.css declares tokens once for
   [data-theme="dark"] and once for the default (light), not a third time
   under a @media(prefers-color-scheme) block for "auto with no attribute
   set" — that duplicate copy is what this file exists to make unnecessary. */
(function () {
  var theme = null;
  try {
    /* 'heavy-iron-v1' duplicates STORAGE_KEY (js/app.js:1) — unavoidable
       since this file runs before app.js defines anything, but it means a
       renamed STORAGE_KEY silently brings back the flash of the wrong theme
       this file exists to prevent, with nothing to catch the drift. */
    var parsed = JSON.parse(localStorage.getItem('heavy-iron-v1'));
    var t = parsed && parsed.prefs && parsed.prefs.theme;
    if (t === 'light' || t === 'dark') theme = t;
  } catch (e) { /* private mode / storage blocked / first run — fall through to system preference */ }
  if (!theme) {
    theme = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', theme);
})();
