import type { TradingDrawingGroupId, TradingDrawingToolId } from './trading-expert-drawing.ts';

// Presentation only: stable tool ids and the existing drawing engine remain independent of menu order.
export const DRAWING_MENU_SECTIONS: ReadonlyArray<{
  id: TradingDrawingGroupId; label: string; icon: string; defaultTool: TradingDrawingToolId;
  sections: ReadonlyArray<{ label: string; tools: readonly TradingDrawingToolId[] }>;
}> = [
  { id: 'cursor', label: '光标', icon: 'crosshair', defaultTool: 'crosshair', sections: [
    { label: '', tools: ['crosshair', 'dot', 'cursor', 'demonstration', 'magic'] },
    { label: '', tools: ['eraser'] },
  ] },
  { id: 'trend', label: '趋势线工具', icon: 'trend', defaultTool: 'trend-line', sections: [
    { label: '线', tools: ['trend-line', 'ray', 'info-line', 'extended-line', 'trend-angle', 'horizontal-line', 'horizontal-ray', 'vertical-line', 'cross-line'] },
    { label: '通道', tools: ['parallel-channel', 'regression-trend', 'flat-top-bottom', 'disjoint-channel'] },
    { label: '分叉线', tools: ['pitchfork', 'schiff-pitchfork', 'modified-schiff-pitchfork', 'inside-pitchfork'] },
  ] },
  { id: 'gann-fib', label: '江恩和斐波那契工具', icon: 'fib', defaultTool: 'fib-retracement', sections: [
    { label: '斐波那契', tools: ['fib-retracement', 'fib-trend-extension', 'fib-channel', 'fib-time-zone', 'fib-speed-fan', 'fib-trend-time', 'fib-circles', 'fib-spiral', 'fib-speed-arcs', 'fib-wedge', 'pitchfan'] },
    { label: '江恩', tools: ['gann-box', 'gann-square-fixed', 'gann-square', 'gann-fan'] },
  ] },
  { id: 'pattern', label: '形态', icon: 'xabcd', defaultTool: 'xabcd', sections: [
    { label: '形态', tools: ['xabcd', 'cypher', 'head-shoulders', 'abcd', 'triangle-pattern', 'three-drives'] },
    { label: '艾略特波浪', tools: ['elliott-impulse', 'elliott-correction', 'elliott-triangle', 'elliott-double-combo', 'elliott-triple-combo'] },
    { label: '循环', tools: ['cyclic-lines', 'time-cycles', 'sine-line'] },
  ] },
  { id: 'prediction', label: '预测和测量工具', icon: 'long-position', defaultTool: 'long-position', sections: [
    { label: '预测', tools: ['long-position', 'short-position', 'forecast', 'bars-pattern', 'ghost-feed', 'sector'] },
    { label: '基于成交量', tools: ['anchored-vwap', 'fixed-range-volume', 'anchored-volume-profile'] },
    { label: '测量', tools: ['price-range', 'date-range', 'date-price-range'] },
    { label: '更多', tools: ['projection', 'measure'] },
  ] },
  { id: 'brush', label: '几何形状', icon: 'brush', defaultTool: 'brush', sections: [
    { label: '笔刷', tools: ['brush', 'highlighter'] },
    { label: '箭头', tools: ['arrow-marker', 'arrow', 'arrow-up', 'arrow-down'] },
    { label: '形状', tools: ['rectangle', 'rotated-rectangle', 'multi-point-path', 'circle', 'ellipse', 'multi-point-polyline', 'triangle', 'arc', 'curve', 'double-curve'] },
    { label: '更多', tools: ['path', 'polyline', 'arrow-left', 'arrow-right'] },
  ] },
  { id: 'annotation', label: '注释工具', icon: 'text', defaultTool: 'text', sections: [
    { label: '文本和笔记', tools: ['text', 'note', 'price-note', 'pin-note', 'table', 'callout', 'comment', 'price-label', 'signpost', 'flag'] },
    { label: '内容', tools: ['image', 'tweet', 'idea'] },
    { label: '更多', tools: ['anchored-text', 'anchored-note'] },
  ] },
  { id: 'icons', label: '图标', icon: 'emoji', defaultTool: 'emoji', sections: [
    { label: '表情符号', tools: ['emoji'] }, { label: '贴纸', tools: ['sticker'] }, { label: '图标', tools: ['icon'] },
  ] },
];

export function drawingMenuGroup(id: TradingDrawingToolId): TradingDrawingGroupId {
  return DRAWING_MENU_SECTIONS.find(group => group.sections.some(section => section.tools.includes(id)))?.id ?? 'trend';
}

export const DRAWING_SHORTCUTS: Readonly<Partial<Record<TradingDrawingToolId, string>>> = {
  'trend-line': 'Alt + T', 'horizontal-line': 'Alt + H', 'horizontal-ray': 'Alt + J',
  'vertical-line': 'Alt + V', 'cross-line': 'Alt + C', 'fib-retracement': 'Alt + F',
  rectangle: 'Alt + Shift + R', text: 'Alt + X',
};

export const DRAWING_SYMBOLS = {
  emoji: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🙂', '😉', '😊', '😍', '🥰', '😎', '🤓', '🤔', '🤨', '😐', '😏', '😴', '😮', '😲', '😳', '🥺', '😢', '😭', '😤', '😡', '🤯', '🥳', '😇', '🤩', '🤑', '👍', '👎', '👏', '🙌', '💪', '🙏', '👀', '🧠', '🐂', '🐻', '🐋', '🦅', '🐢', '🐇', '🌲', '🌵', '🍎', '🍋', '☕', '🍕', '⚽', '🏆', '🎯', '🎲', '🚀', '🛸', '✈️', '🚗', '💡', '🔥', '⚡', '💎', '❤️', '💚', '💙', '💜', '🚩', '🏁', '✅', '❌'],
  sticker: ['🚀', '🐂', '🐻', '💎', '🔥', '🎯', '💰', '🏆', '⚡', '🤑', '👀', '💪', '👍', '👎', '❤️', '🛑'],
  icon: ['↑', '↓', '←', '→', '↗', '↘', '↖', '↙', '↔', '↕', '✓', '✕', '＋', '−', '★', '☆', '●', '○', '■', '□', '▲', '▼', '◆', '◇', '⚑', '⚐', '!', '?', '$', '%', '€', '¥', '♠', '♣', '♥', '♦', '☀', '☁', '☂', '⚡'],
} as const;

const node = (x: number, y: number, r = 1.7) => `<circle cx="${x}" cy="${y}" r="${r}" fill="var(--drawing-icon-fill, var(--trading-market-panel))"/>`;
const nodes = (...points: number[][]) => points.map(p => node(p[0], p[1])).join('');
const path = (d: string) => `<path d="${d}"/>`;
const caption = (text: string, x: number, y: number) => `<text x="${x}" y="${y}" fill="currentColor" stroke="none" font-family="Arial, sans-serif" font-size="6" text-anchor="middle">${text}</text>`;
const wave = (first: string, last: string) => path('M2 19 8 12l7 7 7-7') + nodes([2,19],[8,12],[15,19],[22,12]) + caption(first,8,7) + caption(last,22,7);

// Original SVG artwork, matched to the reference's thin monochrome, hollow-anchor vocabulary.
export const DRAWING_ICON_PATHS: Readonly<Record<string, string>> = {
  cursor: path('M5 3 19 12l-7 1-3 8z'),
  eraser: path('m3 16 11-13a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3L12 22H8zM7 11l9 9M12 22h10'),
  crosshair: path('M12 1v7m0 8v7M1 12h7m8 0h7'),
  dot: '<circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>',
  demonstration: '<circle cx="12" cy="12" r="10"/>' + path('m9 6 9 6-5 1-3 5z'),
  trend: path('M3 21 21 3') + nodes([3,21],[21,3]),
  ray: path('M4 20 22 2') + nodes([4,20],[11,13]),
  extended: path('M1 23 23 1') + nodes([7,17],[16,8]),
  'info-line': path('M3 21 21 3') + nodes([3,21],[21,3]) + '<rect x="15" y="15" width="8" height="8" rx="1"/>',
  angle: path('M3 21h20M3 21 21 3M12 21a9 9 0 0 0-2.6-6.4') + nodes([3,21],[21,3]),
  horizontal: path('M2 12h20') + node(12,12),
  'horizontal-ray': path('M4 12h19') + node(4,12),
  vertical: path('M12 2v20') + node(12,12),
  'cross-line': path('M12 1v22M1 12h22') + node(12,12),
  channel: path('M3 17 17 3M7 22 22 7M9 18l9-9') + nodes([3,17],[17,3],[16,13]),
  regression: path('M3 12 21 3v10L3 22zM3 17 21 8') + nodes([3,12],[21,3],[3,22],[21,13]),
  'flat-channel': path('M3 12 21 4M3 21h18') + nodes([3,12],[21,4],[3,21],[21,21]),
  'disjoint-channel': path('M3 9 21 3M3 15l18 6') + nodes([3,9],[21,3],[3,15],[21,21]),
  pitchfork: path('M3 22 22 3M3 10l9 9M8 16 20 4M12 19 23 8') + nodes([3,22],[3,10],[12,19]),
  schiff: path('M2 22 22 2M3 9l12 12M2 22h13M9 15 22 2M15 21 23 13') + nodes([2,22],[3,9],[15,21]),
  'modified-schiff': path('M2 21 22 1M3 8l13 13M2 21h14M9 14 22 1M16 21 23 14') + nodes([2,21],[3,8],[16,21]),
  'inside-pitchfork': path('M3 22 10 2M3 22l17-1M8 13l12 8M12 15 16 3M20 21 23 11') + nodes([3,22],[8,13],[20,21]),
  fib: path('M1 3h22M1 9h22M1 15h22M1 21h22') + nodes([22,9],[1,21]),
  'fib-extension': path('M2 11 18 3M2 11v6M2 17h21M2 21h21M2 24h21') + nodes([2,11],[18,3],[2,17]),
  'fib-channel': path('M2 12 21 2M2 18 21 8M2 24 21 14') + nodes([2,12],[21,2],[2,18]),
  'time-zone': path('M3 1v22M11 1v22M16 1v22M22 1v22M3 6l8 11') + nodes([3,6],[11,17]),
  'fib-trend-time': path('M2 5 8 21l6-1M15 1v22M19 1v22M23 1v22') + nodes([2,5],[8,21],[14,20]),
  fan: path('M2 22 5 1M2 22 14 1M2 22 23 1M2 22l21-10M2 22h21M2 8h14M16 8v14') + nodes([2,22],[16,8]),
  'fib-circles': '<circle cx="13" cy="11" r="10"/><circle cx="13" cy="11" r="7"/><circle cx="13" cy="11" r="4"/>' + nodes([3,22],[21,3]),
  spiral: path('M2 7C9-1 23 1 21 13c-2 13-20 11-16 0 3-9 15-6 12 1-2 5-9 3-6-1') + nodes([11,13],[21,6]),
  'fib-speed-arcs': path('M1 4a11 13 0 0 0 22 0M5 4a7 9 0 0 0 14 0M9 4a3 5 0 0 0 6 0M12 12v12') + nodes([12,5],[12,19]),
  wedge: path('M3 22V3M3 22h20M3 5a17 17 0 0 1 17 17M3 10a12 12 0 0 1 12 12M3 15a7 7 0 0 1 7 7') + nodes([3,3],[3,22],[23,22]),
  pitchfan: path('M3 22 7 2M3 22 13 1M3 22 22 2M3 22l20-11M3 22h20M7 7l10 13') + nodes([3,22],[7,7],[17,20]),
  gann: '<rect x="2" y="2" width="21" height="21"/>' + path('M9 2v21M16 2v21M2 9h21M2 16h21') + nodes([2,23],[23,2]),
  'gann-square': '<rect x="2" y="2" width="21" height="21"/>' + path('M9 2v21M16 2v21M2 9h21M2 16h21M2 23 23 2M2 2l21 21M2 23 13 2M2 23 23 13') + nodes([2,23],[23,2]),
  'gann-fixed': '<rect x="2" y="2" width="21" height="21"/>' + path('M9 2v21M16 2v21M2 9h21M2 16h21M2 23 23 2M2 2l21 21M2 23a21 21 0 0 1 21-21') + nodes([2,23]),
  brush: path('M1 21c4-2 3-10 8-10a5 5 0 0 1 0 10zM17 5c-4 0-4 5-1 6 2 1 5-4 8-6'),
  text: path('M5 6V3h14v3M12 3v18M9 21h6'),
  xabcd: path('M3 21 6 4 13 12 18 5 21 19 3 21M6 4 21 19M3 21 18 5') + nodes([3,21],[6,4],[13,12],[18,5],[21,19]),
  'long-position': path('M3 4h20M3 20h20M3 15h20M11 6v6h4') + nodes([3,4],[3,20]),
  'short-position': path('M3 4h20M3 20h20M3 9h20M16 12h-2a1.3 1.3 0 0 0 0 2.5h.8a1.3 1.3 0 0 1 0 2.5H12') + nodes([3,4],[3,20]),
  emoji: '<circle cx="12" cy="12" r="10"/>' + path('M7 14a5 5 0 0 0 10 0') + '<circle cx="8" cy="9" r=".8" fill="currentColor"/><circle cx="16" cy="9" r=".8" fill="currentColor"/>',
  ruler: path('m1 18 17-17 6 6L7 24zM5 14l3 3M8 11l2 2M11 8l3 3M14 5l2 2M17 2l3 3'),
  magnet: path('M4 22V10a8 8 0 0 1 16 0v12h-5V10a3 3 0 0 0-6 0v12zM4 17h5M15 17h5'),
  pin: path('M2 16 14 3a2 2 0 0 1 3 0l2 2a2 2 0 0 1 0 3L7 21H2zM12 6l5 5M2 16l5 5') + '<rect x="16" y="17" width="7" height="6" rx="1"/>' + path('M18 17v-3a2 2 0 0 1 4-1M19.5 20v1'),
  'pin-locked': path('M2 16 14 3a2 2 0 0 1 3 0l2 2a2 2 0 0 1 0 3L7 21H2zM12 6l5 5M2 16l5 5') + '<rect x="16" y="17" width="7" height="6" rx="1"/>' + path('M18 17v-3a2 2 0 0 1 4 0v3M19.5 20v1'),
  trash: path('M3 5h18M8 5V2h8v3M5 5l2 18h10l2-18'),
  star: path('m12 2 3 6.2 7 1-5 4.9 1.2 6.9-6.2-3.3L5.8 21 7 14.1 2 9.2l7-1z'),
  table: '<rect x="2" y="3" width="21" height="18"/>' + path('M2 9h21M2 15h21M9 3v18M16 3v18'),
  'pin-note': path('M12 23S4 13 4 9a8 8 0 0 1 16 0c0 4-8 14-8 14z') + '<circle cx="12" cy="9" r="3"/>',
  'price-label': '<rect x="8" y="2" width="15" height="13"/>' + path('M8 15 2 22') + node(2,22),
  image: '<rect x="2" y="3" width="21" height="18" rx="1"/>' + '<circle cx="8" cy="8" r="2"/>' + path('m3 20 6-8 4 5 4-7 5 10'),
  tweet: path('M3 2h5l14 21h-5zM22 2 3 23'),
  idea: path('M8 17c0-5-4-5-4-9a8 8 0 0 1 16 0c0 4-4 4-4 9zM8 20h8M10 23h4'),
  'anchored-vwap': path('M1 18c7 0 7-10 12-10s5 5 10-3M5 2v14M3 5h4v6H3M15 4v17M13 11h4v6h-4'),
  'volume-profile': path('M3 2v21M3 4h6v3H3M3 10h11v3H3M3 16h7v3H3M21 2v21') + node(21,2),
  sector: path('M4 22V3a19 19 0 0 1 19 19z') + nodes([4,22],[4,3],[23,22]),
  'time-cycles': path('M1 20a5 15 0 0 1 10 0 5 15 0 0 1 10 0M1 20h22'),
  'sine-line': path('M1 12C5-3 8-3 12 12s7 15 11 0'),
  'arrow-left': path('M2 12 11 3v5h11v8H11v5z'),
  'arrow-right': path('M22 12 13 3v5H2v8h11v5z'),
  magic: path('m4 22 13-13 3 3L7 25M14 12l3 3M6 1v6M3 4h6M18 1v5M15.5 3.5h5M21 17v6M18 20h6'),
  highlighter: path('m3 17 5-5 2-8 7 7-8 2-5 5zM10 4l3-3M17 11l5-5M2 20c5-2 6 4 11 0l10-7'),
  arrow: path('M3 21 21 3m-6 0h6v6') + nodes([3,21],[12,12]),
  'arrow-marker': path('m2 19 12-9-3-4 12-4-4 12-4-3-10 11z'),
  'arrow-up': path('m4 12 8-10 8 10h-5v10H9V12z'),
  'arrow-down': path('m4 12 8 10 8-10h-5V2H9v10z'),
  rectangle: '<rect x="4" y="4" width="16" height="16"/>' + nodes([4,4],[20,4],[4,20],[20,20]),
  'rotated-rectangle': path('m3 15 12-12 6 6L9 21z') + nodes([3,15],[15,3],[21,9],[9,21],[9,9],[18,6],[15,15],[6,18]),
  'multi-point-path': path('m2 19 6-11 6 10 8-11m-5 0h5v5') + nodes([2,19],[8,8],[14,18]),
  path: path('M2 19c4-14 7 8 12-3S18 5 22 4'),
  circle: '<circle cx="12" cy="12" r="10"/>' + nodes([12,12],[22,12]),
  ellipse: '<ellipse cx="12" cy="12" rx="10" ry="8"/>' + nodes([2,12],[12,4],[22,12],[12,20]),
  'multi-point-polyline': path('m3 20 2-12 9-5 7 7-2 10-9-4z') + nodes([3,20],[5,8],[14,3],[21,10],[19,20],[10,16]),
  polyline: path('m2 19 5-11 6 8 5-13 4 8') + nodes([2,19],[7,8],[13,16],[18,3],[22,11]),
  triangle: path('M4 3 20 21H4z') + nodes([4,3],[20,21],[4,21]),
  arc: path('M3 21 20 3v18zM3 21A17 18 0 0 1 20 3') + nodes([3,21],[20,3],[20,21]),
  curve: path('M3 21Q5 6 20 3') + nodes([3,21],[8,8],[20,3]),
  'double-curve': path('M3 21C25 23 0 2 21 3') + nodes([3,21],[10,20],[14,4],[21,3]),
  'anchored-text': path('M2 5V2h12v3M8 2v15M5 15h6M19 10v11m-4-4 4 4 4-4') + '<circle cx="19" cy="7" r="2"/>',
  note: '<rect x="3" y="3" width="18" height="14"/>' + path('M8 8V6h8v2M12 6v8M10 14h4M12 17v5') + node(12,22),
  'anchored-note': '<rect x="2" y="2" width="16" height="14"/>' + path('M6 7V5h8v2M10 5v8M8 13h4M20 15v7m-3-3 3 3 3-3'),
  'price-note': '<rect x="3" y="3" width="18" height="14"/>' + path('M12 17v5') + node(12,22) + '<text x="12" y="14" fill="currentColor" stroke="none" font-family="Arial, sans-serif" font-size="12" text-anchor="middle">$</text>',
  callout: path('M3 4h18v14H8l-5 4z'),
  comment: path('M3 19v-5a9 7 0 1 1 8 5z'),
  signpost: '<circle cx="12" cy="10" r="9"/>' + path('m12 5 1.5 3 3.5.5-2.5 2.5.5 3.5-3-1.5-3 1.5.5-3.5L7 8.5l3.5-.5zM12 19v4'),
  flag: path('M3 23V3h18l-5 6 5 6H3'),
  cypher: path('m3 21 4-17 4 10 7-8 3 13L3 21M7 4l14 15') + nodes([3,21],[7,4],[11,14],[18,6],[21,19]),
  'head-shoulders': path('m2 22 4-14 4 10 3-17 4 17 3-10 3 14M2 19h21') + nodes([2,22],[6,8],[10,18],[13,1],[17,18],[20,8],[23,22]),
  abcd: path('M3 21 6 5l13 14 2-16M3 21l16-2M6 5l15-2') + nodes([3,21],[6,5],[19,19],[21,3]),
  'triangle-pattern': path('m3 3 20 9L3 22zM3 22 7 5l3 14 6-10') + nodes([3,3],[3,22],[7,5],[10,19],[16,9]),
  'three-drives': path('m2 21 3-16 4 19 4-16 3 16 6-20M2 21 22 4M5 5l11 19') + nodes([2,21],[5,5],[9,24],[13,8],[16,24],[22,4]),
  'elliott-impulse': wave('1','5'),
  'elliott-correction': wave('A','C'),
  'elliott-triangle': wave('A','E'),
  'elliott-double-combo': wave('W','Y'),
  'elliott-triple-combo': wave('W','Z'),
  'cyclic-lines': path('M3 2v20M8 2v20M13 2v20M19 2v20M23 2v20') + nodes([3,12],[8,12],[13,12]),
  'gann-fan': path('M3 22 8 1M3 22 13 1M3 22 22 2M3 22l20-12M3 22l20-5M3 22h20') + nodes([3,22],[13,11]),
  'anchored-volume-profile': path('M21 2v21M21 5H12v3h9M21 11H6v3h15M21 17H12v3h9M3 12h3') + node(3,12),
  forecast: path('M4 4v16M2 8h4v7H2M11 2v20M9 5h4v10H9M18 5v14M16 8h4v3h-4M20 17l2 2-2 2'),
  bars: path('M3 7v13M1 10h4v7H1M9 3v20M7 7h4v11H7M15 5v17M13 8h4v6h-4M21 2v17M19 5h4v8h-4'),
  ghost: path('M2 13v9M1 16h2v4H1M7 10v11M6 13h2v5H6M12 6v13M11 8h2v4h-2M17 1v15M16 4h2v7h-2M22 5v14M21 8h2v4h-2M1 19 23 5'),
  'price-range': path('M3 3h18M3 21h18M12 3v18m-4-14 4-4 4 4') + nodes([21,3],[3,21]),
  'date-range': path('M3 3v18h18V3M3 12h18m-4-4 4 4-4 4') + nodes([3,21],[21,3]),
  'date-price-range': '<rect x="3" y="3" width="18" height="18"/>' + path('M12 4v16M4 12h16m-11-5 3-3 3 3m2 2 3 3-3 3') + nodes([3,21],[21,3]),
  measure: path('M3 21 21 3M6 16l3 3M15 5l4 4') + nodes([3,21],[21,3]),
  projection: path('M3 19 10 10l5 5 7-11') + '<path d="M3 23h19" stroke-dasharray="2 2"/>',
  lock: '<rect x="5" y="11" width="14" height="11" rx="2"/>' + path('M8 11V6a4 4 0 0 1 8 0v5M12 15v3'),
  unlock: '<rect x="5" y="11" width="14" height="11" rx="2"/>' + path('M8 11V6a4 4 0 0 1 7-3M12 15v3'),
  eye: path('M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z') + '<circle cx="12" cy="12" r="3"/>',
  'eye-off': path('M2 2 22 22M8 6a11 11 0 0 1 4-1c6 0 10 7 10 7l-3 4M5 8l-3 4s4 7 10 7l4-1'),
  'drawings-visible': path('M2 9s4-6 9-6 9 6 9 6-4 6-9 6-9-6-9-6zM13 23c2-2 1-5 4-4s1 4-2 4zM19 18q-1 3 1 2l3-3') + '<circle cx="11" cy="9" r="3"/>',
  'drawings-hidden': path('M2 2 21 19M8 3h3c5 0 9 6 9 6l-3 4M5 5 2 9s4 6 9 6l4-1M13 23c2-2 1-5 4-4s1 4-2 4zM19 18q-1 3 1 2l3-3'),
  zoom: '<circle cx="10" cy="10" r="7"/>' + path('m15 15 8 8M6 10h8M10 6v8'),
  'zoom-out': '<circle cx="10" cy="10" r="7"/>' + path('m15 15 8 8M6 10h8'),
  undo: path('M9 7 4 12l5 5M5 12h8a6 6 0 0 1 6 6'),
  redo: path('m15 7 5 5-5 5m4-5h-8a6 6 0 0 0-6 6'),
  reset: path('M4 4v6h6M6 17a8 8 0 1 0-2-8'),
  color: path('m5 18 2-5L17 3a2 2 0 0 1 3 3L10 15zM4 22h16'),
  templates: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
};

export function renderDrawingIcon(name: string) {
  const artwork = DRAWING_ICON_PATHS[name];
  if (!artwork) throw new Error(`Unknown drawing icon: ${name}`);
  return `<svg viewBox="0 0 24 24" data-drawing-icon="${name}" aria-hidden="true">${artwork}</svg>`;
}
