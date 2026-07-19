/**
 * Applies the saved theme before the page paints.
 *
 * This has to be a blocking inline script in <head>: anything that waits for
 * React would let the page paint in the wrong theme first, and a white flash on
 * a dark till at night is exactly what the toggle is meant to avoid.
 *
 * localStorage holds the *preference* ('light' | 'dark' | 'system'); the
 * `data-theme` attribute holds the *resolved* value and is always concrete, so
 * the CSS never has to reason about "system".
 */

export const THEME_STORAGE_KEY = 'campaign-scanner-theme';

const script = `
(function () {
  try {
    var pref = localStorage.getItem('${THEME_STORAGE_KEY}') || 'system';
    var dark = pref === 'dark' ||
      (pref === 'system' &&
       window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  } catch (e) {
    // Private browsing can throw on localStorage. Fall through to the
    // prefers-color-scheme rule in globals.css rather than break the page.
  }
})();
`;

export default function ThemeScript() {
  return (
    <script
      // Static string, no interpolated user input.
      dangerouslySetInnerHTML={{ __html: script }}
    />
  );
}
