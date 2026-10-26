import {executionPlanCardHeading,executionPlanStructuredCardBody} from './execution-plan-card-view.mjs';
import {localizedChoice} from '../shared/korean.mjs';
const copy={
  'zh-CN':{title:'交易计划',blocked:'当前不建议开仓；此卡片供参考，不能启用入场提醒。',missing:'数据不足，价格暂不可用。',entry:'入场',stop:'止损',targets:'三档止盈',news:'因为你选择了“不在重大数据公布前开仓”，且目前缺少可核验的重大事件日历，所以不建议开仓。',stopCap:'结构止损超过有效止损距离上限。',targetCap:'调整后的止盈超过有效止盈距离上限。',entryCap:'入场价超过有效距离上限。',trend:'方向不符合顺势要求，或趋势证据不足。',other:'当前条件尚未通过校验，具体原因见分析正文。'},
  'zh-TW':{title:'交易計畫',blocked:'目前不建議開倉；此卡片供參考，不能啟用入場提醒。',missing:'資料不足，價格暫不可用。',entry:'入場',stop:'止損',targets:'三檔止盈',news:'因為你選擇了「不在重大資料公布前開倉」，且目前缺少可核驗的重大事件日曆，所以不建議開倉。',stopCap:'結構止損超過有效止損距離上限。',targetCap:'調整後的止盈超過有效止盈距離上限。',entryCap:'入場價超過有效距離上限。',trend:'方向不符合順勢要求，或趨勢證據不足。',other:'目前條件尚未通過校驗，具體原因見分析正文。'},
  en:{title:'Trading plan',blocked:'Opening a position is not recommended. This reference card cannot activate entry reminders.',missing:'Required data is missing; prices are unavailable.',entry:'Entry',stop:'Stop',targets:'Three profit targets',news:'Because you selected “Do not open before major data releases” and no verifiable event calendar is available, opening a position is not recommended.',stopCap:'The structural stop exceeds the effective distance limit.',targetCap:'The adjusted exits exceed the effective target distance limit.',entryCap:'Entry exceeds the effective distance limit.',trend:'The direction conflicts with the trend rule or trend evidence is missing.',other:'Conditions have not passed validation. See the analysis for details.'},
  ko:{title:'거래 계획',blocked:'현재 진입을 권장하지 않습니다. 이 참고 카드에서는 진입 알림을 활성화할 수 없습니다.',missing:'필요한 데이터가 없어 가격을 제공할 수 없습니다.',entry:'진입',stop:'손절',targets:'세 익절 목표',news:'주요 지표 발표 전 진입 금지를 선택했으며 확인 가능한 경제 일정이 없어 진입을 권장하지 않습니다.',stopCap:'구조적 손절이 유효 거리 한도를 초과합니다.',targetCap:'조정된 목표가 유효 목표 거리 한도를 초과합니다.',entryCap:'진입 가격이 유효 거리 한도를 초과합니다.',trend:'방향이 추세 규칙과 상충하거나 추세 근거가 부족합니다.',other:'조건 검증을 통과하지 못했습니다. 자세한 내용은 분석을 확인하세요.'},
};
const reasonKey={NEWS_EVIDENCE_UNAVAILABLE:'news',STOP_DISTANCE_EXCEEDED:'stopCap',TARGET_DISTANCE_EXCEEDED:'targetCap',ENTRY_DISTANCE_EXCEEDED:'entryCap',TREND_CONSTRAINT_CONTRADICTED:'trend',TREND_EVIDENCE_UNAVAILABLE:'trend'};
export function planPresentationCard(report,language) {
  language=language==='zh-Hant'?'zh-TW':language;
  const t=copy[language]||copy['zh-CN'],p=report.executionPlan.planPresentation,s=p?.scenario;
  // Outcomes without price scenarios use the separate observation card.
  // Do not turn an unavailable signal into an empty price grid.
  if(p?.status!=='not_recommended'||!s)return null;
  const title=`${report.marketId} · ${report.executionPlan.context?.interval||report.interval} · ${localizedChoice(['条件交易计划','Conditional trading plan','條件交易計畫'],language)}`;
  const reasons=[...new Set((p?.reasons||[report.executionPlan.outcome?.reason]).map(r=>t[reasonKey[r]||'other']))];
  const heading=executionPlanCardHeading(title,[{label:'Direction',text:s?.side||''},{label:'Strategy',text:report.strategyId}],language);
  const body=executionPlanStructuredCardBody({entry:s.trigger,entryMode:s.mode,stop:s.stop,targets:s.targets,direction:s.side,riskReward:s.riskReward,hideAction:true},language);
  const advice=[t.blocked,...reasons];
  const content=[title,`${t.entry}: ${s.entry}`,`${t.stop}: ${s.stop}`,`${t.targets}: ${s.targets.join(' / ')}`,...advice].join('\n');
  // Advice stays in the analysis text. The card keeps the original heading,
  // entry/stop metrics and three target rows, with no extra sections or badges.
  return {title,content,readOnly:true,html:heading+body};
}
