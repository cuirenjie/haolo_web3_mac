import { normalizeXPostUrl } from '../shared/trading-x-post.mjs';
import { translateAppText } from './app-language.mjs';
export interface TradingXPost { url: string; authorName: string; handle: string; body: string; createdAt: string; avatarUrl: string }
const PREFIX = 'haolo.trading-x-post.';
export function readTradingXPost(url: string): TradingXPost | null {
  const post = normalizeXPostUrl(url);
  if (!post) return null;
  try {
    const saved = JSON.parse(localStorage.getItem(PREFIX + post.id) ?? 'null');
    return saved?.url === post.url && ['authorName', 'handle', 'body', 'createdAt', 'avatarUrl'].every(key => typeof saved[key] === 'string') ? saved : null;
  } catch { return null; }
}
export class TradingXPostDialog {
  private dialog: HTMLDialogElement | null = null;
  private generation = 0;
  get open() { return Boolean(this.dialog?.open); }
  close() { this.generation++;this.dialog?.close();this.dialog?.remove();this.dialog=null; }
  show(host: HTMLElement, confirm: (post: TradingXPost) => void, initial = '') {
    this.close();const generation=this.generation;
    const dialog=document.createElement('dialog');dialog.className='trading-x-post-dialog';dialog.setAttribute('aria-label',translateAppText('帖子'));
    dialog.innerHTML=`<form><button type="button" data-post-cancel class="trading-x-post-close" aria-label="关闭">×</button><h2>帖子</h2><input type="url" data-post-url placeholder="插入指向X帖子的链接" aria-label="插入指向X帖子的链接" autocomplete="off" maxlength="2048"><p data-post-error role="alert" hidden></p><footer><button type="button" data-post-cancel>取消</button><button type="submit" disabled>确认</button></footer></form>`;
    this.dialog=dialog;host.append(dialog);
    const input=dialog.querySelector<HTMLInputElement>('input')!,submit=dialog.querySelector<HTMLButtonElement>('[type="submit"]')!,error=dialog.querySelector<HTMLElement>('[data-post-error]')!;
    input.value=initial;submit.disabled=!normalizeXPostUrl(initial);
    input.addEventListener('input',()=>{submit.disabled=!normalizeXPostUrl(input.value);error.hidden=true;});
    dialog.querySelectorAll('[data-post-cancel]').forEach(button=>button.addEventListener('click',()=>this.close()));
    dialog.addEventListener('cancel',event=>{event.preventDefault();this.close();});
    dialog.querySelector('form')!.addEventListener('submit',async event=>{
      event.preventDefault();const parsed=normalizeXPostUrl(input.value);if(!parsed||submit.disabled)return;
      submit.disabled=true;input.disabled=true;submit.textContent=translateAppText('正在加载…');error.hidden=true;
      try {
        const api=window.codexDesktop.getTradingXPost;
        if(!api)throw new Error('请重启客户端后再添加帖子');
        const response=await api(parsed.url);
        if(generation!==this.generation)return;
        const body=typeof response.body==='string'?response.body:new DOMParser().parseFromString(response.html??'','text/html').querySelector('blockquote p')?.textContent??'';
        if(!body)throw new Error('无法读取该帖子，请检查链接或网络后重试');
        const post:TradingXPost={url:parsed.url,authorName:response.authorName,handle:response.handle,body,createdAt:response.createdAt,avatarUrl:response.avatarUrl};
        localStorage.setItem(PREFIX+parsed.id,JSON.stringify(post));this.close();confirm(post);
      }catch(failure){if(generation!==this.generation)return;error.textContent=translateAppText(failure instanceof Error?failure.message:'无法读取该帖子，请检查链接或网络后重试');error.hidden=false;}
      finally{if(generation===this.generation){input.disabled=false;submit.disabled=!normalizeXPostUrl(input.value);submit.textContent=translateAppText('确认');}}
    });
    for(const type of ['pointerdown','click','dblclick','keydown'])dialog.addEventListener(type,event=>event.stopPropagation());
    dialog.showModal();input.focus();
  }
}
