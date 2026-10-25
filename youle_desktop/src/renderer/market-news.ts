import QRCode from 'qrcode';
import { appLanguageLocale } from './app-language.mjs';
import './market-news.css';

export type NewsMarket = { coin: string; quote: string; symbol: string; venue: string; marketType: string; changePercent: number | null };
export type NewsItem = { id: string; title: string; content: string; timestamp: number; important: boolean; source: string; url: string; markets: NewsMarket[]; bullish: number; bearish: number; vote: number };
export type NewsPage = { items: NewsItem[]; nextCursor: string | null; status: string; fetchedAt: number | null };
export type NewsQuery = { day?: string; cursor?: string; language?: string };
const messages = {
  'zh-CN': ['K线','快讯','浏览器','正在开发中，还未上线','选择日期','取消','确定','今','利好','利空','分享','加载中…','暂无快讯','加载失败，请重试','重试','加载更多','最新快讯','数据更新暂时延迟','关闭','复制图片','X','Telegram','下载','链接','图片已复制，可粘贴分享','链接已复制','图片已保存','操作失败，请重试','查看详情','来源','扫码阅读快讯','该交易对暂未提供行情','打开K线失败，请重试','群聊','上一年','上个月','下个月','下一年','日,一,二,三,四,五,六'],
  'zh-TW': ['K線','快訊','瀏覽器','正在開發中，尚未上線','選擇日期','取消','確定','今','利好','利空','分享','載入中…','暫無快訊','載入失敗，請重試','重試','載入更多','最新快訊','資料更新暫時延遲','關閉','複製圖片','X','Telegram','下載','連結','圖片已複製，可貼上分享','連結已複製','圖片已儲存','操作失敗，請重試','查看詳情','來源','掃碼閱讀快訊','此交易對暫未提供行情','開啟K線失敗，請重試','群聊','上一年','上個月','下個月','下一年','日,一,二,三,四,五,六'],
  en: ['Candlestick chart','News flashes','Browser','In development. Not yet available.','Choose date','Cancel','Confirm','Today','Bullish','Bearish','Share','Loading…','No news flashes','Unable to load. Try again.','Retry','Load more','Latest news','Updates are temporarily delayed','Close','Copy image','X','Telegram','Download','Link','Image copied. Paste to share.','Link copied','Image saved','Something went wrong. Try again.','Read details','Source','Scan to read the news','Market data is unavailable for this pair','Unable to open chart. Try again.','Chat','Previous year','Previous month','Next month','Next year','Su,Mo,Tu,We,Th,Fr,Sa'],
  ko: ['캔들 차트','속보','브라우저','개발 중이며 아직 출시되지 않았습니다.','날짜 선택','취소','확인','오늘','호재','악재','공유','불러오는 중…','속보가 없습니다','불러오지 못했습니다. 다시 시도해 주세요.','다시 시도','더 보기','최신 속보','업데이트가 지연되고 있습니다','닫기','이미지 복사','X','Telegram','다운로드','링크','이미지가 복사되었습니다. 붙여넣어 공유하세요.','링크가 복사되었습니다','이미지가 저장되었습니다','실패했습니다. 다시 시도해 주세요.','속보 보기','출처','스캔하여 속보 읽기','이 거래쌍의 시세를 제공하지 않습니다','차트를 열 수 없습니다. 다시 시도해 주세요.','채팅','이전 연도','이전 달','다음 달','다음 연도','일,월,화,수,목,금,토'],
};
const language = () => { const l = appLanguageLocale(); return l === 'zh-CN' || l === 'zh-TW' ? l : l === 'ko-KR' ? 'ko' : 'en'; };
const words = () => messages[language()];
const NEWS_BRAND = 'Haolo';
const brandedText = (value: string) => value.replace(/aicoin/gi, NEWS_BRAND);
const newsShareUrl = (id: string) => 'https://haolo.com/api/market-data/news/share/' + encodeURIComponent(id);
const brandedItem = (item: NewsItem): NewsItem => ({...item, title:brandedText(item.title), content:brandedText(item.content), source:NEWS_BRAND, url:newsShareUrl(item.id)});
const escape = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const newsDay = (stamp = Date.now()) => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(stamp);
const dateLabel = (day: string, options: Intl.DateTimeFormatOptions) => new Date(day + 'T12:00:00+08:00').toLocaleDateString(appLanguageLocale(), {...options, timeZone:'Asia/Shanghai'});
const timeLabel = (stamp: number) => new Date(stamp * 1000).toLocaleTimeString(appLanguageLocale(), {timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false});
const paths: Record<string,string> = {
  chart:'<path d="M7 2v3m0 14v3M17 2v5m0 12v3"/><rect x="4" y="5" width="6" height="14" rx=".5"/><rect x="14" y="7" width="6" height="10" rx=".5"/>',
  news:'<path d="M3 2h16v20H3zM19 7h3v15h-3M7 6h3v4H7zM13 6h3M13 10h3M7 14h9M7 18h9"/>',
  browser:'<circle cx="12" cy="12" r="10"/><ellipse cx="12" cy="12" rx="4" ry="10"/><path d="M2 12h20"/>',
  up:'<path d="m12 2 9 10h-6v10H9V12H3z"/>', down:'<path d="m12 22 9-10h-6V2H9v10H3z"/>',
  share:'<path d="M10 4H3v17h17v-8M14 3h7v7M21 3 11 13"/>',
  copy:'<rect x="7" y="7" width="14" height="14" rx="2"/><path d="M17 7V3H3v14h4M10 12h8M10 16h8"/>',
  download:'<path d="M12 2v13m-5-5 5 5 5-5M3 14v7h18v-7"/>',
  chat:'<path d="M3 3h18v14h-7l-6 4v-4H3zM7 8h10M7 12h7"/>',
  x:'<path d="m4 3 16 18h-5L3 3h5l13 18M20 3 4 21"/>',
  telegram:'<path d="m2 10 20-8-6 20-5-8-9-4Zm9 4L22 2"/>',
};
const icon = (name: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.share}</svg>`;

export function renderMarketPageSwitch() {
  return '<div class="market-page-switch" data-market-page-switch data-i18n-skip></div><section class="market-news" data-market-news data-i18n-skip hidden></section>';
}

export class MarketNewsController {
  private mode: 'chart' | 'news' = 'chart';
  private menu = false;
  private items: NewsItem[] = [];
  private cursor: string | null = null;
  private day = '';
  private loading = false;
  private failure = false;
  private stale = false;
  private generation = 0;
  private voteBusy = new Set<string>();
  private voteRevision = 0;
  private disposed = false;
  private calendar: {month: string; selected: string} | null = null;
  private timer: number;
  private toastTimer = 0;
  private observer: MutationObserver;
  private locale = language();
  private shareDialog: HTMLDialogElement | null = null;
  private switchHost: HTMLElement;
  private panel: HTMLElement;
  constructor(private host: HTMLElement, private openMarket: (market: NewsMarket) => Promise<void>) {
    this.switchHost = host.querySelector('[data-market-page-switch]')!;
    this.panel = host.querySelector('[data-market-news]')!;
    host.addEventListener('click', this.click);
    document.addEventListener('pointerdown', this.outside);
    document.addEventListener('keydown', this.keydown);
    this.observer = new MutationObserver(() => {
      if (this.locale === language()) return;
      this.locale = language(); this.renderSwitch(); this.closeShare();
      if (this.mode === 'news') void this.load();
    });
    this.observer.observe(document.documentElement, {attributes:true, attributeFilter:['lang']});
    this.timer = window.setInterval(() => {
      if (this.mode === 'news' && !this.day && !document.hidden && !this.loading && !this.voteBusy.size && this.panel.scrollTop < 100 && !this.shareDialog) void this.load(false, true);
    }, 60_000);
    this.renderSwitch();
  }
  private renderSwitch() {
    const t = words();
    this.switchHost.innerHTML = `<button type="button" class="market-page-trigger" data-news-action="menu" aria-haspopup="menu" aria-expanded="${this.menu}" aria-label="${t[this.mode === 'chart' ? 0 : 1]}" title="${t[this.mode === 'chart' ? 0 : 1]}">${icon(this.mode)}</button>${this.menu ? `<div class="market-page-menu" role="menu">${['chart','news','browser'].map((mode,i) => `<button type="button" role="menuitemradio" aria-checked="${this.mode === mode}" data-news-action="${mode}">${icon(mode)}<span>${t[i]}</span>${this.mode === mode ? '<span class="market-page-check">✓</span>' : ''}</button>`).join('')}</div>` : ''}`;
  }
  setMode(mode: 'chart' | 'news') {
    this.mode = mode; this.menu = false; this.calendar = null;
    this.host.classList.toggle('market-news-active', mode === 'news');
    this.panel.hidden = mode !== 'news';
    this.host.querySelector<HTMLElement>('.trading-market-content')!.inert = mode === 'news';
    this.host.querySelector<HTMLElement>('[data-drawing-toolbar]')!.inert = mode === 'news';
    this.renderSwitch();
    if (mode === 'news') { this.render(); if (!this.items.length) void this.load(); }
    else { this.generation++; this.loading = false; this.closeShare(); }
  }
  private async load(more = false, quiet = false) {
    if (this.disposed || this.loading && more) return;
    const generation = ++this.generation, voteRevision = this.voteRevision;
    this.loading = true; this.failure = false;
    if (!quiet) this.render();
    try {
      const result = await window.codexDesktop?.getMarketNews?.({day:this.day || undefined,cursor:more ? this.cursor || undefined : undefined,language:language() === 'en' ? 'en' : 'cn'});
      if (this.disposed || generation !== this.generation) return;
      if (!result || result.status === 'unavailable') throw Error('NEWS_UNAVAILABLE');
      result.items = result.items.map(brandedItem);
      if (voteRevision !== this.voteRevision || this.voteBusy.size) {
        for (const item of result.items) {
          const previous = this.items.find(row => row.id === item.id);
          if (previous) Object.assign(item, {vote:previous.vote,bullish:previous.bullish,bearish:previous.bearish});
        }
      }
      this.items = more ? [...new Map([...this.items,...result.items].map(row => [row.id,row])).values()] : result.items;
      this.cursor = result.nextCursor; this.stale = result.status === 'stale';
    } catch { if (generation === this.generation) this.failure = true; }
    finally { if (!this.disposed && generation === this.generation) { this.loading = false; this.render(); } }
  }
  private dateButton(day: string) {
    return `<button type="button" class="market-news-date" data-news-action="calendar" data-day="${day}" aria-label="${words()[4]}: ${day}"><strong>${Number(day.slice(8))}</strong><small>${escape(dateLabel(day,{month:'short'}))}</small></button>`;
  }
  private render() {
    const t = words(); let previous = '';
    this.panel.innerHTML = `<div class="market-news-top"><strong>${t[1]}</strong><div><button type="button" data-news-action="latest">${t[16]}</button><button type="button" data-news-action="calendar" aria-label="${t[4]}">${escape(this.day || newsDay())} ▾</button></div></div>
      ${this.failure || this.stale ? `<div class="market-news-notice" role="status">${this.failure ? t[13] : t[17]} <button type="button" data-news-action="retry">${t[14]}</button></div>` : ''}
      <div class="market-news-timeline">${this.items.map(item => {
        const day = newsDay(item.timestamp * 1000), date = previous !== day ? this.dateButton(day) : ''; previous = day;
        return `<article class="market-news-row" data-news-id="${item.id}"><div class="market-news-date-slot">${date}</div><time datetime="${new Date(item.timestamp * 1000).toISOString()}">${timeLabel(item.timestamp)}</time><div class="market-news-dot"></div><div class="market-news-copy"><h2 class="${item.important ? 'important' : ''}">${escape(item.title)}</h2><p>${escape(item.content)}</p><div class="market-news-markets">${item.markets.map((market,index) => `<button type="button" data-news-action="market" data-index="${index}" class="${(market.changePercent || 0) < 0 ? 'negative' : 'positive'}" title="${escape(market.coin+'/'+market.quote)}">${escape(market.coin)}${market.changePercent == null ? '' : ` ${market.changePercent >= 0 ? '+' : ''}${market.changePercent.toFixed(2)}%`}</button>`).join('')}</div><div class="market-news-actions">${[1,-1].map((direction,index) => `<button type="button" data-news-action="vote" data-direction="${direction}" aria-pressed="${item.vote === direction}" class="${index ? 'bearish' : 'bullish'}" ${this.voteBusy.has(item.id) ? 'disabled' : ''}>${icon(index ? 'down' : 'up')} ${t[8+index]} <span>${index ? item.bearish : item.bullish}</span></button>`).join('')}<button type="button" data-news-action="share">${icon('share')}${t[10]}</button><button type="button" class="market-news-source" data-news-action="source" title="${t[28]}">↗ ${escape(item.source)}</button></div></div></article>`;
      }).join('')}</div><div class="market-news-bottom" role="status">${this.loading ? t[11] : !this.items.length && !this.failure ? `${this.dateButton(this.day || newsDay())}<p>${t[12]}</p>` : this.cursor ? `<button type="button" data-news-action="more">${t[15]}</button>` : ''}</div>${this.calendar ? this.renderCalendar() : ''}`;
  }
  private renderCalendar() {
    const t = words(), current = this.calendar!;
    const first = new Date(current.month + '-01T12:00:00Z'), start = new Date(first);
    start.setUTCDate(1-first.getUTCDay());
    const days = Array.from({length:42},(_,i) => { const d = new Date(start); d.setUTCDate(start.getUTCDate()+i); const day=d.toISOString().slice(0,10); return `<button type="button" data-news-action="day" data-day="${day}" class="${day.slice(0,7)!==current.month ? 'outside' : ''} ${day === current.selected ? 'selected' : ''}" aria-pressed="${day === current.selected}" aria-label="${day}" ${day > newsDay() ? 'disabled' : ''}>${day===newsDay() ? t[7] : d.getUTCDate()}</button>`; }).join('');
    return `<div class="market-news-calendar" role="dialog" aria-label="${t[4]}"><header>${[-12,-1].map((step,i) => `<button type="button" data-news-action="month" data-step="${step}" aria-label="${t[34+i]}">${i ? '‹' : '«'}</button>`).join('')}<strong>${escape(dateLabel(current.month+'-01',{year:'numeric',month:'long'}))}</strong>${[1,12].map((step,i) => `<button type="button" data-news-action="month" data-step="${step}" aria-label="${t[36+i]}">${i ? '»' : '›'}</button>`).join('')}</header><div class="market-news-week">${t[38].split(',').map(s=>`<span>${s}</span>`).join('')}</div><div class="market-news-days">${days}</div><footer><button type="button" data-news-action="cancel-date">${t[5]}</button><button type="button" data-news-action="confirm-date">${t[6]}</button></footer></div>`;
  }
  private click = (event: Event) => {
    const button = (event.target as Element)?.closest<HTMLElement>('[data-news-action]');
    if (!button || !this.host.contains(button)) return;
    event.stopPropagation(); const action = button.dataset.newsAction!;
    const item = this.items.find(row=>row.id===button.closest<HTMLElement>('[data-news-id]')?.dataset.newsId);
    if (action === 'menu') { this.menu=!this.menu; this.renderSwitch(); }
    else if (action === 'chart' || action === 'news') this.setMode(action);
    else if (action === 'browser') { this.menu=false; this.renderSwitch(); this.toast(words()[3]); }
    else if (action === 'calendar') { const day=button.dataset.day || this.day || newsDay(); this.calendar={month:day.slice(0,7),selected:day}; this.render(); this.panel.querySelector<HTMLButtonElement>('.market-news-days .selected')?.focus(); }
    else if (action === 'cancel-date') { this.calendar=null; this.render(); }
    else if (action === 'day' && this.calendar) { this.calendar.selected=button.dataset.day!; this.render(); }
    else if (action === 'month' && this.calendar) { const d=new Date(this.calendar.month+'-01T12:00:00Z'); d.setUTCMonth(d.getUTCMonth()+Number(button.dataset.step)); this.calendar.month=d.toISOString().slice(0,7); this.render(); }
    else if (action === 'confirm-date' || action === 'latest') { this.day=action==='latest' ? '' : this.calendar!.selected; this.calendar=null; this.items=[]; this.cursor=null; this.panel.scrollTop=0; void this.load(); }
    else if (action === 'more' || action === 'retry') void this.load(action==='more');
    else if (action === 'vote' && item) void this.vote(item,Number(button.dataset.direction));
    else if (action === 'share' && item) void this.share(item, button);
    else if (action === 'source' && item) void window.codexDesktop?.openExternal(item.url);
    else if (action === 'market' && item) {
      const market = item.markets[Number(button.dataset.index)];
      if (market) { button.setAttribute('disabled',''); void this.openMarket(market).then(()=> { if(!this.disposed) this.setMode('chart'); }).catch((error)=>this.toast(words()[String(error?.message)==='NEWS_MARKET_UNAVAILABLE' ? 31 : 32])).finally(()=>button.removeAttribute('disabled')); }
    }
  };
  private outside = (event: Event) => {
    const target=event.target as Element;
    if(this.menu && !this.switchHost.contains(target)){this.menu=false;this.renderSwitch();}
    if(this.calendar && !target.closest('.market-news-calendar,[data-news-action="calendar"]')){this.calendar=null;this.render();}
  };
  private keydown = (event: KeyboardEvent) => {
    if (event.key==='Escape') { this.menu=false; this.calendar=null; this.renderSwitch(); if(this.mode==='news')this.render(); }
  };
  private async vote(item: NewsItem, direction: number) {
    if(this.voteBusy.has(item.id))return;
    this.voteBusy.add(item.id); this.voteRevision++; this.render();
    try {
      const result=await window.codexDesktop?.voteMarketNews?.({id:item.id,direction:item.vote===direction ? 0 : direction});
      if(!result)throw Error('VOTE_FAILED');
      if(!this.disposed) { const current=this.items.find(row=>row.id===item.id); if(current)Object.assign(current,result); }
    } catch { if(!this.disposed)this.toast(words()[27]); }
    finally {this.voteBusy.delete(item.id);this.voteRevision++;if(!this.disposed)this.render();}
  }
  private toast(message: string) {
    if(this.disposed)return;
    this.host.querySelector('.market-news-toast')?.remove(); clearTimeout(this.toastTimer);
    const node=document.createElement('div');node.className='market-news-toast';node.setAttribute('role','status');node.setAttribute('data-i18n-skip','');node.textContent=message;this.host.append(node);
    this.toastTimer=window.setTimeout(()=>node.remove(),3500);
  }
  private closeShare() {this.shareDialog?.close();this.shareDialog?.remove();this.shareDialog=null;}
  private async share(item: NewsItem, opener: HTMLElement) {
    this.closeShare(); const t=words(); const dialog=document.createElement('dialog');dialog.className='market-news-share';dialog.setAttribute('aria-label',t[10]);dialog.setAttribute('data-i18n-skip','');
    dialog.innerHTML=`<button type="button" class="market-news-share-close" aria-label="${t[18]}">×</button><div class="market-news-share-preview">${t[11]}</div><p role="status" data-share-status></p><div class="market-news-share-actions">${['chat','x','telegram','download','copy'].map((name,i)=>`<button type="button" data-share="${i}" disabled>${icon(name)}<span>${t[[33,20,21,22,23][i]]}</span></button>`).join('')}</div>`;
    document.body.append(dialog);this.shareDialog=dialog;dialog.showModal();
    dialog.querySelector('button')!.onclick=()=>dialog.close();
    dialog.addEventListener('click',e=>{const r=dialog.getBoundingClientRect(),m=e as MouseEvent;if(e.target===dialog && (m.clientX<r.left||m.clientX>r.right||m.clientY<r.top||m.clientY>r.bottom))dialog.close();});
    dialog.addEventListener('close',()=>{if(this.shareDialog===dialog)this.shareDialog=null;dialog.remove();if(opener.isConnected)opener.focus();});
    const status=dialog.querySelector<HTMLElement>('[data-share-status]')!;
    let image='';
    const copyImage=async()=>{const api=window.codexDesktop?.copyAttachmentToClipboard;if(!api)throw Error('COPY_UNAVAILABLE');const response=await api({kind:'image',name:`Haolo-news-${item.id}.png`,mime:'image/png',base64:image.split(',')[1]});if(response?.ok===false)throw Error('COPY_FAILED');status.textContent=t[24];};
    try {
      // Use the same localized article shown in the timeline, never a different language from detail.
      image=await renderNewsShareImage(item);
      if(!dialog.open)return;
      const img=document.createElement('img');img.src=image;img.alt=item.title;dialog.querySelector('.market-news-share-preview')!.replaceChildren(img);
      dialog.querySelectorAll<HTMLButtonElement>('[data-share]').forEach(button=>{button.disabled=false;button.onclick=async()=>{
        button.disabled=true;
        try {
          switch(Number(button.dataset.share)) {
            case 0: await copyImage();break;
            case 1: await window.codexDesktop?.openExternal(`https://x.com/intent/tweet?${new URLSearchParams({text:item.title,url:item.url})}`);break;
            case 2: await window.codexDesktop?.openExternal(`https://t.me/share/url?${new URLSearchParams({url:item.url,text:item.title})}`);break;
            case 3: if((await window.codexDesktop?.saveMarketNewsImage?.({dataUrl:image}))?.saved)status.textContent=t[26];break;
            case 4: await navigator.clipboard.writeText(item.url);status.textContent=t[25];break;
          }
        }catch{status.textContent=t[27];}finally{button.disabled=false;}
      };});
      try{await copyImage();}catch{status.textContent=t[19];}
    }catch{status.textContent=t[27];}
  }
  destroy() {
    this.disposed=true;this.generation++;clearInterval(this.timer);clearTimeout(this.toastTimer);this.observer.disconnect();this.closeShare();
    this.host.removeEventListener('click',this.click);document.removeEventListener('pointerdown',this.outside);document.removeEventListener('keydown',this.keydown);
  }
}

export async function renderNewsShareImage(item: NewsItem) {
  item = brandedItem(item);
  const t=words(),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d')!;
  const wrap=(value:string,size:number,width:number,bold=false)=>{
    ctx.font=`${bold ? 700 : 400} ${size}px "Segoe UI", "Microsoft YaHei", sans-serif`;
    const lines:string[]=[];let line='';
    for(const token of value.match(/\n|[A-Za-z0-9]+(?:[.,:/%\-][A-Za-z0-9]+)*|[^\x00-\x7F]|\s+|./g)||[]){
      if(token==='\n'){lines.push(line);line='';continue;}
      if(ctx.measureText(token).width>width){for(const char of token){if(ctx.measureText(line+char).width>width){lines.push(line);line=char;}else line+=char;}continue;}
      if(ctx.measureText(line+token).width>width){lines.push(line.trimEnd());line=token.trimStart();}else line+=token;
    }
    if(line)lines.push(line);return lines;
  };
  const title=wrap(item.title,32,536,true),body=wrap(item.content,26,536);
  canvas.width=640;canvas.height=320+title.length*44+body.length*38+180;
  const gradient=ctx.createLinearGradient(0,0,0,canvas.height);gradient.addColorStop(0,'#eaf8ff');gradient.addColorStop(1,'#ffffff');ctx.fillStyle=gradient;ctx.fillRect(0,0,640,canvas.height);
  ctx.fillStyle='#111';ctx.font='700 44px "Segoe UI", "Microsoft YaHei", sans-serif';ctx.fillText(`${NEWS_BRAND} · ${t[1]}`,36,84);
  ctx.fillStyle='#fff';ctx.beginPath();ctx.roundRect(24,120,592,canvas.height-144,22);ctx.fill();ctx.strokeStyle='#dedede';ctx.stroke();
  ctx.fillStyle='#888';ctx.font='20px "Segoe UI", "Microsoft YaHei", sans-serif';ctx.fillText(`${newsDay(item.timestamp*1000)} ${timeLabel(item.timestamp)}`,52,165);
  ctx.fillText(`${t[29]}: ${item.source}`,52,195,536);
  let y=250;ctx.textBaseline='top';
  const draw=(lines:string[],size:number,lineHeight:number,color:string,bold=false)=>{ctx.fillStyle=color;ctx.font=`${bold?700:400} ${size}px "Segoe UI", "Microsoft YaHei", sans-serif`;for(const line of lines){ctx.fillText(line,52,y);y+=lineHeight;}};
  draw(title,32,44,'#171717',true);y+=24;draw(body,26,38,'#777');y+=35;
  ctx.strokeStyle='#ececec';ctx.beginPath();ctx.moveTo(52,y);ctx.lineTo(588,y);ctx.stroke();y+=30;
  const qr=await QRCode.toDataURL(item.url,{width:130,margin:1,errorCorrectionLevel:'M'});const img=new Image();img.src=qr;await img.decode();ctx.drawImage(img,458,y,130,130);
  ctx.fillStyle='#777';ctx.font='23px "Segoe UI", "Microsoft YaHei", sans-serif';ctx.fillText(t[30],52,y+35,380);ctx.font='21px "Segoe UI", sans-serif';ctx.fillText('haolo.com',52,y+76);
  return canvas.toDataURL('image/png');
}
