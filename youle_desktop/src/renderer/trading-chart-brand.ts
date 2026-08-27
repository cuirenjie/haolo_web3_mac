const wordmarkUrl = new URL("./assets/haolo-chart-wordmark.png", import.meta.url).href;
let nextBrandId = 0;

export function renderTradingChartBrand() {
  const id = `trading-chart-brand-${++nextBrandId}`;
  // Keep the supplied lettering intact. The mask removes its dark backdrop,
  // while currentColor lets both themes use the same original artwork.
  return `
    <svg class="trading-market-brand" viewBox="25 10 166 50" role="img" aria-label="Haolo." focusable="false">
      <defs>
        <filter id="${id}-ink" color-interpolation-filters="sRGB">
          <feComponentTransfer>
            <feFuncR type="linear" slope="1.2" intercept="-0.12" />
            <feFuncG type="linear" slope="1.2" intercept="-0.12" />
            <feFuncB type="linear" slope="1.2" intercept="-0.12" />
          </feComponentTransfer>
        </filter>
        <mask id="${id}-mask" maskUnits="userSpaceOnUse" x="25" y="10" width="166" height="50" style="mask-type: luminance">
          <image href="${wordmarkUrl}" width="219" height="77" filter="url(#${id}-ink)" />
        </mask>
      </defs>
      <rect x="25" y="10" width="166" height="50" fill="currentColor" mask="url(#${id}-mask)" />
    </svg>
  `;
}
