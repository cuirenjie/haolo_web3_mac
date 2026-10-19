const words={
  title:['计划提醒','Plan reminder','計畫提醒'],
  notice:['条件满足只产生提醒，不表示成交，不会自动下单。','Conditions only produce reminders; they do not indicate fills or place orders.','條件滿足只產生提醒，不表示成交，不會自動下單。'],
  entry:['入场条件已满足','Entry condition satisfied','入場條件已滿足'],
  stop:['止损条件已满足','Stop condition satisfied','止損條件已滿足'],
  target:['止盈条件已满足','Target condition satisfied','止盈條件已滿足'],
};
const t=(key,language)=>words[key]?.[language==='en'?1:['zh-TW','zh-Hant'].includes(language)?2:0]||key;
const time=value=>{const date=new Date(Number(value));return Number(value)>0&&Number.isFinite(date.getTime())?date.toISOString():'';};
const eventLabel=(event,language)=>t(event.data.condition==='entry'?'entry':event.data.condition==='stop'?'stop':'target',language);
export function cloudAlertNotification({alert,event},language='zh-CN') {
  return {title:`${t('title',language)} · ${alert.rule.marketKey}`,
    body:`${eventLabel(event,language)} · ${alert.rule.interval} · ${event.data.price}\n${time(event.data.occurredAt)}\n${t('notice',language)}`};
}
