import { vietnameseText } from './vietnamese.mjs';
const locale = language => String(language).startsWith('vi') ? 'vi' : String(language).startsWith('ja') ? 'ja' : String(language).startsWith('ko') ? 'ko'
  : String(language).startsWith('en') ? 'en' : /TW|Hant/i.test(language) ? 'zh-Hant' : 'zh-CN';

export function priceAlertDeliveryDescription(language = 'zh-CN') {
  return {
    'zh-CN': '到价后发送一次邮件；客户端在线且消息弹窗开启时，同时显示桌面提醒。',
    'zh-Hant': '到價後傳送一次郵件；用戶端在線且訊息彈窗開啟時，同時顯示桌面提醒。',
    en: 'Email once at the target price, with a desktop alert when the app is online and popups are enabled.',
    ko: '목표 가격에 도달하면 이메일을 한 번 보냅니다. 앱이 온라인이고 팝업이 켜져 있으면 데스크톱 알림도 표시합니다.',
    ja: '目標価格に達するとメールを一度送信します。アプリがオンラインでポップアップが有効な場合は、デスクトップにも通知します。', vi: vietnameseText("目標価格に達するとメールを一度送信します。アプリがオンラインでポップアップが有効な場合は、デスクトップにも通知します。"),
  }[locale(language)];
}

export function priceAlertSummary(operator, price, language = 'zh-CN') {
  const sign = {gte:'≥', lte:'≤', gt:'>', lt:'<', cross_over:'↑', cross_under:'↓'}[operator];
  const level = Number(price).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:12});
  return {
    'zh-CN': `价格 ${sign} ${level} 时发送一次邮件；在线且开启弹窗时同时桌面提醒`,
    'zh-Hant': `價格 ${sign} ${level} 時傳送一次郵件；在線且開啟彈窗時同時桌面提醒`,
    en: `Email once when price ${sign} ${level}; also notify on desktop when online with popups enabled`,
    ko: `가격 ${sign} ${level} 시 이메일을 한 번 보냅니다. 온라인 상태에서 팝업이 켜져 있으면 데스크톱에도 알림`,
    ja: `価格 ${sign} ${level} でメールを一度送信。オンラインでポップアップが有効な場合はデスクトップにも通知`, vi: `Gửi email một lần khi giá ${sign} ${level}. Nếu ứng dụng đang trực tuyến và thông báo bật lên được bật, hệ thống cũng sẽ thông báo trên màn hình`,
  }[locale(language)];
}
