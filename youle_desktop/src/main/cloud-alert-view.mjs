import { vietnameseText } from '../shared/vietnamese.mjs';
import { koreanText, localizedChoice } from '../shared/korean.mjs';
import {isCloudPriceRule} from './trading-alerts/cloud-notification-event.mjs';
const words={
  title:['计划提醒','Plan reminder','計畫提醒'],
  alertTitle:['预警触发','Alert triggered','預警觸發'],
  price:['价格条件已满足','Price condition satisfied','價格條件已滿足'],
  compound:['复合预警条件已满足','Compound alert conditions satisfied','複合預警條件已滿足'],
  notice:['条件满足只产生提醒，不表示成交，不会自动下单。','Conditions only produce reminders; they do not indicate fills or place orders.','條件滿足只產生提醒，不表示成交，不會自動下單。'],
  entry:['入场条件已满足','Entry condition satisfied','入場條件已滿足'],
  stop:['止损条件已满足','Stop condition satisfied','止損條件已滿足'],
  target:['止盈条件已满足','Target condition satisfied','止盈條件已滿足'],
  break_even:['已达到保本条件，请按计划将止损移至保本价','Break-even condition satisfied; move the stop to the planned break-even price','已達到保本條件，請按計畫將停損移至保本價'],
  time:['已达到计划持仓时间上限','Planned holding-time limit reached','已達到計畫持倉時間上限'],
  structure:['计划结构已失效','Plan structure invalidated','計畫結構已失效'],
};
const korean={title:'계획 알림',notice:'조건 충족은 알림만 생성하며 체결을 의미하거나 주문을 실행하지 않습니다.',entry:'진입 조건 충족',stop:'손절 조건 충족',target:'익절 조건 충족',break_even:'본전 조건 충족: 계획된 본전 가격으로 손절을 이동하세요',time:'계획된 최대 보유 시간에 도달했습니다',structure:'계획 구조가 무효화되었습니다'};
Object.assign(korean,{alertTitle:'알림 발생',price:'가격 조건 충족',compound:'복합 알림 조건 충족'});
const vietnamese={title:vietnameseText("プラン通知"),alertTitle:vietnameseText("アラート発動"),price:vietnameseText("価格条件を満たしました"),compound:vietnameseText("複合アラート条件を満たしました")};
const japanese={title:'プラン通知',alertTitle:'アラート発動',price:'価格条件を満たしました',compound:'複合アラート条件を満たしました'};
const t=(key,language)=>language==='vi'&&vietnamese[key] ? vietnamese[key] : language==='ja'&&japanese[key]?japanese[key]:language==='ko'&&korean[key]?korean[key]:words[key]?localizedChoice(words[key],language):key;
const time=value=>{const date=new Date(Number(value));return Number(value)>0&&Number.isFinite(date.getTime())?date.toISOString():'';};
const eventLabel=(event,language)=>{
  const condition=event.data.condition||'price',key=condition.startsWith('target:')?'target':condition;
  return t(key,language)+(key==='target'?` ${Number(condition.split(':')[1])+1}`:'');
};
export function cloudAlertNotification({alert,event},language='zh-CN') {
  const priceAlert=isCloudPriceRule(alert.rule);
  const stop=event.data.condition==='break_even'?` → ${alert.rule.preferenceExitPolicy?.breakEvenPrice}`:'';
  const level=priceAlert?` · ${{gte:'≥',lte:'≤',gt:'>',lt:'<',cross_over:'↑',cross_under:'↓'}[alert.rule.operator]} ${alert.rule.threshold}`:'';
  const symbol=alert.rule.marketKey.replace(/^binance:(?:usdm|spot):/i,'');
  return {title:`${t(priceAlert||alert.rule.kind==='compound_v1'?'alertTitle':'title',language)} · ${symbol}`,
    body:`${eventLabel(event,language)}${level}${stop} · ${alert.rule.interval} · ${event.data.price}\n${time(event.data.occurredAt)}\n${t('notice',language)}`,
    alertId:priceAlert?`cloud-price-${alert.id}`:alert.id,evidenceId:event.data.eventId,
    marketId:alert.rule.marketKey.replace('binance:usdm:','BINANCE:FUTURES:').replace('binance:spot:','BINANCE:SPOT:'),
    interval:alert.rule.interval,triggeredAt:event.data.occurredAt};
}
