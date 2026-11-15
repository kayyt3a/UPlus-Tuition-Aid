// Shows typed fractions such as 5/8 or 2 3/4 as proper stacked fractions (numerator over a line over denominator).
// Returns escaped HTML. Students still type answers as 5/8, so marking is unaffected.
(function () {
  const UNI = { '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4', '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5', '⅙': '1/6', '⅚': '5/6', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8' };
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const frac = (n, d) => `<span class="frac"><span class="num">${n}</span><span class="sl">/</span><span class="den">${d}</span></span>`;
  // Not touching a digit, slash, dot or comma on either side, so dates (12/05/2024), decimals and 1/2/3 stay as typed.
  const RE = /(?<![\d\/.,])(?:(\d{1,6}) )?(\d{1,6})\/(\d{1,6})(?![\d\/]|[.,]\d)/g;
  window.fmtMaths = s => esc(String(s ?? '').replace(/(\d?)([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/g, (m, w, f) => (w ? w + ' ' : '') + UNI[f]))
    .replace(RE, (m, w, n, d) => w ? `<span class="mixed">${w}${frac(n, d)}</span>` : frac(n, d));
})();
