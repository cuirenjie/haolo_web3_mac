export const TASKBAR_QUOTE_WIDTH = 151;
export const TASKBAR_QUOTE_MIN_WIDTH = 122;
export const TASKBAR_QUOTE_HEIGHT = 40;

export function normalizeTaskbarMarketQuote(value) {
  if (!value || typeof value !== "object") return null;
  const text = (input, max) => String(input ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
  const marketId = text(value.marketId, 128);
  const name = text(value.name, 96);
  if (!marketId || !name) return null;
  const price = typeof value.price === "number" && Number.isFinite(value.price) && value.price > 0 ? value.price : null;
  const changePercent = price !== null && typeof value.changePercent === "number" && Number.isFinite(value.changePercent)
    ? value.changePercent : null;
  return { marketId, name, price, priceText: price === null ? "--" : text(value.priceText, 32), changePercent };
}

// All coordinates here are Electron DIPs. Never cover another taskbar button.
export function taskbarMarketQuoteBounds(layout) {
  const bar = layout?.bar;
  const anchor = layout?.anchor;
  const valid = (rect) => rect && ["x", "y", "width", "height"].every((key) => Number.isFinite(rect[key]))
    && rect.width > 0 && rect.height > 0;
  if (!layout?.visible || !valid(bar) || !valid(anchor) || bar.height > 100 || bar.width < TASKBAR_QUOTE_MIN_WIDTH) return null;
  if (anchor.x < bar.x || anchor.x + anchor.width > bar.x + bar.width
    || anchor.y >= bar.y + bar.height || anchor.y + anchor.height <= bar.y) return null;
  const height = Math.min(TASKBAR_QUOTE_HEIGHT, bar.height - 4);
  if (height < 28) return null;
  const gap = 6;
  const endGap = gap + 10; // Keep the quote 10 DIP shorter even when space is constrained.
  const occupied = [anchor, ...(layout.occupied || [])].filter(valid)
    .filter((rect) => rect.y < bar.y + bar.height && rect.y + rect.height > bar.y)
    .sort((a, b) => a.x - b.x);
  let x = Math.max(bar.x + gap, anchor.x + anchor.width + gap);
  let width = TASKBAR_QUOTE_WIDTH;
  for (const rect of occupied) {
    if (rect.x + rect.width + gap <= x) continue;
    const available = rect.x - endGap - x;
    if (available >= TASKBAR_QUOTE_MIN_WIDTH) {
      width = Math.min(width, available);
      break;
    }
    x = rect.x + rect.width + gap;
  }
  width = Math.min(width, bar.x + bar.width - endGap - x);
  if (width < TASKBAR_QUOTE_MIN_WIDTH) return null;
  return { x: Math.round(x), y: Math.round(bar.y + (bar.height - height) / 2), width: Math.floor(width), height: Math.round(height) };
}

export function taskbarMarketQuoteHtml() {
  return `<!doctype html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
<style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
body{--text:#172033;--up:#078c53;--down:#d63857;font:12px/17px "Segoe UI","Microsoft YaHei",sans-serif;color:var(--text)}
body.dark{--text:#f2f4f8;--up:#52dc88;--down:#ff718e}
button{display:flex;flex-direction:column;justify-content:center;align-items:flex-start;width:100%;height:100%;padding:1px 8px;border:0;border-radius:4px;background:rgba(243,243,243,.94);color:inherit;font:inherit;cursor:pointer;text-align:left}
body.dark button{background:rgba(35,35,35,.96)}
button:hover{background:#e3e7ed}body.dark button:hover{background:#3c4048}
button:active{opacity:.8}button:focus-visible{outline:1px solid currentColor;outline-offset:-2px}
strong{display:flex;width:100%;gap:8px;font-weight:500;white-space:nowrap}
#symbol{min-width:0;overflow:hidden;text-overflow:ellipsis}
#tag,#change{flex:none;margin-left:auto;text-align:right}
.values{display:flex;width:100%;gap:8px;white-space:nowrap;font-variant-numeric:tabular-nums}
b,em{font:inherit;font-style:normal;font-weight:500}.up{color:var(--up)}.down{color:var(--down)}
</style></head><body><button id="quote" type="button"><strong id="name"><span id="symbol"></span><span id="tag"></span></strong><span class="values"><b id="price">--</b><em id="change">--</em></span></button>
<script>
let previous=null, flash=null;
const button=document.getElementById("quote"), price=document.getElementById("price"), change=document.getElementById("change");
window.taskbarQuote.onQuote(value=>{
  document.body.classList.toggle("dark",value.dark===true);
  document.documentElement.lang=value.language==="en"?"en":"zh-CN";
  const tagStart=value.name.lastIndexOf(" ");
  document.getElementById("symbol").textContent=tagStart<0?value.name:value.name.slice(0,tagStart);
  document.getElementById("tag").textContent=tagStart<0?"":value.name.slice(tagStart+1);
  price.textContent=value.priceText;
  if(!previous||previous.marketId!==value.marketId||value.price===null){clearTimeout(flash);price.className=""}
  else if(previous.price!==null&&previous.price!==value.price){
    clearTimeout(flash);price.className=value.price>previous.price?"up":"down";
    flash=setTimeout(()=>price.className="",800);
  }
  change.textContent=value.changePercent===null?"--":value.changePercent.toFixed(2)+"%";
  change.className=value.changePercent===null?"":value.changePercent>=0?"up":"down";
  button.title=value.name+"\\n"+value.priceText+" "+change.textContent;
  button.setAttribute("aria-label",button.title);
  const values=document.querySelector(".values");values.style.fontSize="12px";
  if(values.scrollWidth>button.clientWidth-16)values.style.fontSize="11px";
  if(values.scrollWidth>button.clientWidth-16)values.style.fontSize="10px";
  previous=value;
});
button.addEventListener("click",()=>window.taskbarQuote.activate());
</script></body></html>`;
}
