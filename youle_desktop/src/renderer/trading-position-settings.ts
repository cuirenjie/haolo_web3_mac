import type { TradingDrawingModel } from './trading-expert-drawing.ts';
import { normalizePositionOptions, positionAnchors, type PositionOptions } from './trading-position-tools.ts';
import { colorPickerInput } from './color-picker.ts';

export function positionSettingsDialog(drawing: TradingDrawingModel, confirm: (d: TradingDrawingModel) => void, close: () => void, host: HTMLElement, trigger?: HTMLElement) {
  const dialog = document.createElement('dialog');
  dialog.className = 'trading-horizontal-line-dialog'; dialog.dataset.i18nDrawing = '';
  const options = normalizePositionOptions(drawing.position), points = positionAnchors(drawing);
  const number = (key: string, label: string, min = '0', step = 'any') => `<label class="trading-line-settings-row"><span>${label}</span><input name="${key}" type="number" min="${min}" step="${step}" required aria-label="${label}"></label>`;
  dialog.innerHTML = `<form><header><h2>${drawing.tool === 'short-position' ? '空头仓位' : '多头仓位'}</h2><button type="button" data-line-cancel aria-label="关闭">×</button></header>
    <div class="trading-line-settings-tabs" role="tablist">${[['inputs','参数'],['style','样式'],['coordinates','坐标']].map(([id,label])=>`<button type="button" role="tab" data-line-tab="${id}">${label}</button>`).join('')}</div>
    <section data-line-panel="inputs">${number('accountSize','账户资金','.01')}${number('risk','风险')}
      <label class="trading-line-settings-row"><span>风险单位</span><select name="riskMode"><option value="percent">%</option><option value="amount">金额</option></select></label>
      ${number('leverage','杠杆（0 表示不限制）')}${number('lotSize','每手数量','.00000001')}${number('pointValue','点值','.00000001')}${number('tickSize','最小变动价位','.00000001')}${number('quantityPrecision','数量精度','0','1')}</section>
    <section data-line-panel="style" hidden>${['profitColor','lossColor'].map((key,i)=>`<label class="trading-line-settings-row"><span>${i ? '止损颜色' : '目标颜色'}</span>${colorPickerInput(options[key as 'profitColor'|'lossColor'],`name="${key}"`)}</label>`).join('')}
      ${number('fillOpacity','填充不透明度','0','.05')}${number('fontSize','字号','10','1')}
      <label class="trading-line-settings-check"><input name="alwaysShowStats" type="checkbox"><span>始终显示统计</span></label></section>
    <section data-line-panel="coordinates" hidden>${number('entry','入场价格','.00000001')}${number('target','目标价格','.00000001')}${number('stop','止损价格','.00000001')}
      ${[0,1].map(i=>`<label class="trading-line-settings-row"><span>${i ? '终点时间 (UTC+8)' : '起点时间 (UTC+8)'}</span><input name="time${i}" type="datetime-local" step="1" required></label>`).join('')}</section>
    <footer><button type="button" data-line-cancel>取消</button><button class="primary" type="submit">确认</button></footer></form>`;
  const form = dialog.querySelector('form')!;
  const field = (key: string) => form.elements.namedItem(key) as HTMLInputElement;
  for (const [key,value] of Object.entries(options)) { if (typeof value === 'boolean') field(key).checked = value; else field(key).value = String(value); }
  for (const [key,value] of Object.entries({ entry: points[0].price, target: points[2].price, stop: points[3].price, fontSize: drawing.fontSize ?? 12 })) field(key).value = String(value);
  field('fillOpacity').max = '1'; field('quantityPrecision').max = '8'; field('fontSize').max = '36';
  for (const i of [0,1]) field(`time${i}`).value = new Date((points[i].time + 28800) * 1000).toISOString().slice(0,19);
  const tabs = [...dialog.querySelectorAll<HTMLButtonElement>('[data-line-tab]')];
  const select = (key: string) => {
    tabs.forEach(t=>{ t.setAttribute('aria-selected',String(t.dataset.lineTab===key));t.tabIndex=t.dataset.lineTab===key?0:-1; });
    dialog.querySelectorAll<HTMLElement>('[data-line-panel]').forEach(p=>p.hidden=p.dataset.linePanel!==key);
  };
  dialog.addEventListener('click', e=>{ const b=(e.target as Element).closest<HTMLButtonElement>('button');if(b?.hasAttribute('data-line-cancel'))close();if(b?.dataset.lineTab)select(b.dataset.lineTab); });
  dialog.addEventListener('keydown', e=>{ const i=tabs.indexOf(e.target as HTMLButtonElement);if(i<0||!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const next=tabs[(i+(e.key==='ArrowLeft'?2:1))%3];select(next.dataset.lineTab!);next.focus(); });
  form.addEventListener('invalid', e=>select((e.target as Element).closest<HTMLElement>('[data-line-panel]')!.dataset.linePanel!),true);
  form.addEventListener('input',()=>{field('entry').setCustomValidity('');field('time1').setCustomValidity('');});
  form.addEventListener('submit', e=>{
    e.preventDefault(); const entry=Number(field('entry').value), target=Number(field('target').value), stop=Number(field('stop').value), sign=drawing.tool==='short-position'?-1:1;
    if(sign*(target-entry)<=0||sign*(entry-stop)<=0){field('entry').setCustomValidity('入场价格必须位于目标与止损之间');form.reportValidity();return;}
    const times=[0,1].map(i=>Date.parse(field(`time${i}`).value+'+08:00')/1000);
    if(!times.every(Number.isFinite)||times[1]<=times[0]){field('time1').setCustomValidity('终点时间必须晚于起点时间');form.reportValidity();return;}
    const values: Record<string,unknown>={}; for(const [key,value] of Object.entries(options)) values[key]=typeof value==='boolean'?field(key).checked:typeof value==='number'?Number(field(key).value):field(key).value;
    const next={...drawing,position:normalizePositionOptions(values as Partial<PositionOptions>),fontSize:Number(field('fontSize').value),points:[{time:times[0],price:entry},{time:times[1],price:entry},{time:times[0],price:target},{time:times[0],price:stop}]};close();confirm(next);
  });
  dialog.addEventListener('cancel',e=>{e.preventDefault();close();});dialog.addEventListener('close',()=>{if(trigger?.isConnected)trigger.focus();});
  host.append(dialog);dialog.showModal();select('inputs');tabs[0].focus();return dialog;
}
