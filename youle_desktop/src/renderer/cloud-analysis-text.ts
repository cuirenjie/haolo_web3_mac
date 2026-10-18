const words={
  submit:['正在向云端提交 {market} {interval} 分析；行情与策略证据由服务端读取。','Submitting {market} {interval} analysis. The server will retrieve market data and strategy evidence.','正在向雲端提交 {market} {interval} 分析；行情與策略證據由伺服器讀取。'],
  drawing:['云端分析已完成，正在绘制冻结的结构与条件价位。','Cloud analysis completed. Drawing the frozen structures and conditional levels.','雲端分析已完成，正在繪製凍結的結構與條件價位。'],
  drawingStep:['正在逐笔绘制分析标注。','Drawing the analysis annotations.','正在逐筆繪製分析標註。'],
  splitStart:['首窗已完成，正在分别分析另外 {count} 个提交时可见的分屏。','The first chart is complete. Analyzing the other {count} charts visible at submission.','首窗已完成，正在分別分析另外 {count} 個提交時可見的分屏。'],
  splitDrawing:['{market} 分析完成，正在绘图。','{market} analysis completed. Drawing its annotations.','{market} 分析完成，正在繪圖。'],
  splitDone:['另外 {count} 个分屏已完成独立分析。','Independent analysis completed for {count} additional charts.','另外 {count} 個分屏已完成獨立分析。'],
  splitPartial:['主图分析继续有效；已纳入 {count} 个分屏，另有 {failed} 个分屏未能完成。','The main chart analysis remains valid. Included {count} additional charts; {failed} charts could not complete.','主圖分析繼續有效；已納入 {count} 個分屏，另有 {failed} 個分屏未能完成。'],
  complete:['云端报告和条件校验已完成。','The cloud report and condition validation are complete.','雲端報告和條件校驗已完成。'],
  position:['已完成仓位复核，正在整理本次仓位问题的回答。','Position review completed. Preparing the answer to your position question.','已完成倉位複核，正在整理本次倉位問題的回答。'],
  direct:['已完成复核，正在整理本次问题的回答。','Review completed. Preparing the answer to your question.','已完成複核，正在整理本次問題的回答。'],
  missing:['云端未返回有效分析结果。','The cloud service did not return a valid analysis result.','雲端未返回有效分析結果。'],
  cancelled:['分析已由用户停止。','Analysis was stopped by the user.','分析已由使用者停止。'],
};
export function cloudAnalysisText(key:keyof typeof words,language:string,values:Record<string,string|number>={}) {
  const index=language==='en'||language==='en-US'?1:['zh-TW','zh-Hant'].includes(language)?2:0;
  return words[key][index].replace(/\{(\w+)\}/g,(_match,name)=>String(values[name]??''));
}
