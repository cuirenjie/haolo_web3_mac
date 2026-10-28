// Recognition view of application-authored Japanese/Vietnamese plan fields. Never persist
// this view or use it as display copy; the original report remains authoritative.
const aliases = {
  'Hợp đồng vĩnh cửu Binance': 'Binance Perpetual',
  'Kế hoạch Long có điều kiện': '多头条件方案', 'Kế hoạch Short có điều kiện': '空头条件方案',
  'Kế hoạch mua có điều kiện': '多头条件方案', 'Kế hoạch bán có điều kiện': '空头条件方案',
  'Kế hoạch thực hiện': '执行计划', 'Kế hoạch giao dịch': '执行计划',
  'Hành động hiện tại': '当前动作', 'Nhận định xu hướng': '方向判断',
  'Điều kiện kích hoạt Long': '多头触发', 'Điều kiện kích hoạt Short': '空头触发',
  'Điều kiện vào lệnh': '入场触发', 'Kích hoạt vào lệnh': '入场触发',
  'Cắt lỗ và vô hiệu hóa': '止损与失效', 'Cắt lỗ': '止损',
  'Chốt lời từng phần': '分批止盈', 'Chốt lời': '止盈',
  'Tỷ lệ lợi nhuận/rủi ro': '风险收益比', 'Tỷ lệ rủi ro/lợi nhuận': '风险收益比',
  'Nguồn chiến lược': '策略来源', 'Chiến lược': '策略',
  'Thiên về tăng': '偏多', 'Thiên về giảm': '偏空', 'Trung lập': '中性',
  'Chưa rõ': '未明确', 'Chưa xác định': '待定', 'Đứng ngoài': '观望',
  'Chờ đợi': '等待', 'Không có': '无',
  'Quản lý rủi ro': '风险管理', 'Xu hướng và cấu trúc': '趋势与结构',
  'Hỗ trợ và kháng cự': '支撑与阻力',
  'Binance 無期限先物':'Binance Perpetual', 'Binance無期限先物':'Binance Perpetual',
  'Binance 無期限':'Binance Perpetual', 'Binance無期限':'Binance Perpetual',
  'ロング条件付きプラン':'多头条件方案', 'ショート条件付きプラン':'空头条件方案',
  'ロング条件プラン':'多头条件方案', 'ショート条件プラン':'空头条件方案',
  '条件付き取引計画':'执行计划', '実行計画':'执行计划', '実行プラン':'执行计划',
  '現在のアクション':'当前动作', '方向性の判断':'方向判断', '方向性判断':'方向判断',
  'ロングトリガー':'多头触发', 'ショートトリガー':'空头触发', '方向トリガー':'方向触发',
  'エントリートリガー':'入场触发', 'エントリー条件':'入场触发',
  '損切りと無効化':'止损与失效', '損切り・無効化':'止损与失效', '損切り':'止损',
  '段階的な利確':'分批止盈', '分割利確':'分批止盈', '利確目標':'分批止盈', '利確':'止盈',
  'リスクリワード比':'风险收益比', 'リスクリワード':'风险收益比', '損益比':'风险收益比',
  'ストラテジーソース':'策略来源', 'ストラテジー':'策略', '戦略':'策略',
  'ロング':'多头', 'ショート':'空头', '強気':'偏多', '弱気':'偏空',
  '中立':'中性', '不明確':'未明确', '未確定':'待定', '様子見':'观望', '待機':'等待',
  '該当なし':'暂无', 'なし':'无',
  'リスク管理':'风险管理', 'トレンドと構造':'趋势与结构', 'サポートとレジスタンス':'支撑与阻力',
};
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const pattern=new RegExp(Object.keys(aliases).sort((a,b)=>b.length-a.length).map(escape).join('|'),'gu');
export function executionPlanRecognitionText(value) {
  return String(value??'').replace(pattern,key=>aliases[key]);
}
