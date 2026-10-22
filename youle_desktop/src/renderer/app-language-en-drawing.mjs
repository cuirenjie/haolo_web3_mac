// Reviewed against TradingView's English drawing menus and Drawings List:
// https://www.tradingview.com/charting-library-docs/latest/ui_elements/drawings/Drawings-List/
// Keep this catalog scoped to drawing UI. Complete terms must never go through
// the general-purpose substring replacement (e.g. 分叉线 must be Pitchfork).
export const ENGLISH_DRAWING_TOOLS = Object.freeze({
  "箭头": "Arrow", "十字线": "Cross", "橡皮擦": "Eraser",
  "趋势线": "Trendline", "射线": "Ray", "信息线": "Info line",
  "延长线": "Extended line", "趋势角度": "Trend angle",
  "水平线": "Horizontal line", "水平射线": "Horizontal ray",
  "垂直线": "Vertical line", "横线": "Crossline",
  "平行通道": "Parallel channel", "回归趋势": "Regression trend",
  "平顶/平底": "Flat top/bottom", "不相交通道": "Disjoint channel",
  "分叉线": "Pitchfork", "希夫干草叉": "Schiff pitchfork",
  "改良希夫干草叉": "Modified Schiff pitchfork", "内部分叉线": "Inside pitchfork",
  "江恩箱": "Gann box", "江恩正方": "Gann square", "江恩扇": "Gann fan",
  "固定江恩正方": "Gann square fixed",
  "斐波那契回撤": "Fib retracement", "斐波那契趋势扩展": "Trend-based fib extension",
  "斐波那契速度阻力扇": "Fib speed resistance fan", "斐波那契时区": "Fib time zone",
  "斐波那契圈": "Fib circles", "斐波那契螺旋": "Fib spiral",
  "斐波那契通道": "Fib channel", "斐波那契楔形": "Fib wedge",
  "倾斜扇形": "Pitchfan", "斐波那契趋势时间": "Trend-based fib time",
  "斐波那契速度阻力弧": "Fib speed resistance arcs",
  "笔刷": "Brush", "荧光笔": "Highlighter", "自由路径": "Freehand path",
  "矩形": "Rectangle", "旋转矩形": "Rotated rectangle", "圆": "Circle",
  "椭圆": "Ellipse", "三角形": "Triangle", "弧形": "Arc", "曲线": "Curve",
  "双曲线": "Double curve", "预设折线": "Preset polyline", "路径": "Path", "折线": "Polyline",
  "文字": "Text", "锚定文本": "Anchored text", "笔记": "Note",
  "价格笔记": "Price note", "价格注释": "Price note", "指示牌": "Signpost",
  "标注": "Callout", "评论": "Comment", "箭头标记": "Arrow marker",
  "向上箭头": "Arrow mark up", "向下箭头": "Arrow mark down",
  "向左箭头": "Arrow mark left", "向右箭头": "Arrow mark right", "旗标": "Flag mark",
  "XABCD 形态": "XABCD pattern", "赛福形态": "Cypher pattern",
  "头肩形态": "Head and shoulders", "ABCD 形态": "ABCD pattern",
  "三角形态": "Triangle pattern", "三驱形态": "Three drives pattern",
  "艾略特脉冲波（1·2·3·4·5）": "Elliott impulse wave (12345)",
  "艾略特修正浪（A·B·C）": "Elliott correction wave (ABC)",
  "艾略特三角波（A·B·C·D·E）": "Elliott triangle wave (ABCDE)",
  "艾略特双重组合浪（W·X·Y）": "Elliott double combo wave (WXY)",
  "艾略特三重组合浪（W·X·Y·X·Z）": "Elliott triple combo wave (WXYXZ)",
  "循环线": "Cyclic lines", "时间循环": "Time cycles", "正弦线": "Sine line",
  "多头仓位": "Long position", "空头仓位": "Short position", "仓位预测": "Position forecast",
  "日期范围": "Date range", "价格范围": "Price range", "日期和价格范围": "Date and price range",
  "K线形态": "Bars pattern", "模拟K线": "Ghost feed", "价格投影": "Price projection",
  "固定范围成交量分布图": "Fixed range volume profile", "测量": "Measure",
  "魔法": "Magic", "圆点": "Dot", "荧光笔光标": "Demonstration",
  "锚定VWAP": "Anchored VWAP", "锚定成交量分布图": "Anchored volume profile", "扇形": "Sector",
  "锚定笔记": "Anchored note", "置顶": "Pin", "表格": "Table", "价格标签": "Price label",
  "图片": "Image", "帖子": "X post", "观点": "Idea",
  "表情符号": "Emojis", "贴纸": "Stickers", "图标": "Icons",
});

export const ENGLISH_DRAWING_SECTIONS = Object.freeze({
  "线": "LINES", "通道": "CHANNELS", "分叉线": "PITCHFORKS",
  "斐波那契": "FIBONACCI", "江恩": "GANN", "形态": "PATTERNS",
  "艾略特波浪": "ELLIOTT WAVES", "循环": "CYCLES", "预测": "PROJECTION",
  "基于成交量": "VOLUME-BASED", "测量": "MEASUREMENT", "更多": "MORE",
  "笔刷": "BRUSHES", "箭头": "ARROWS", "形状": "SHAPES",
  "文本和笔记": "TEXT & NOTES", "内容": "CONTENT", "视图与历史": "VIEW & HISTORY",
  "表情符号": "EMOJIS", "贴纸": "STICKERS", "图标": "ICONS",
});

const PHRASES = Object.freeze({
  "笔记 · 拖出线段后输入文字，也可依次点击两个端点": "Note · Drag a line and enter text, or click the two endpoints in order",
  "已更新图片": "Image updated", "已更新帖子": "Post updated", "帖子已添加": "Post added",
  "帖子内容暂不可用，双击重新加载": "Post unavailable; double-click to reload",
  "链接到帖子": "Link to post", "背景": "Background", "字号": "Font size",
  "入场价格必须位于目标与止损之间": "Entry price must be between the target and stop",
  "终点时间必须晚于起点时间": "End time must be later than start time",
  "目标": "Target", "止损": "Stop", "金额": "Amount", "数量": "Qty", "已平仓": "Closed", "开仓": "Open", "风险/回报比": "Risk/Reward Ratio",
  "成功": "Success", "失败": "Failure", "在": "in", "天": "days", "小时": "hours", "分钟": "minutes",
  "账户资金": "Account size", "风险": "Risk", "风险单位": "Risk unit", "杠杆（0 表示不限制）": "Leverage (0 = no cap)", "每手数量": "Lot size", "点值": "Point value",
  "最小变动价位": "Tick size", "数量精度": "Quantity precision", "目标颜色": "Target color", "止损颜色": "Stop color", "始终显示统计": "Always show stats",
  "入场价格": "Entry price", "目标价格": "Target price", "止损价格": "Stop price", "请选择至少两根 K 线": "Select at least two bars",
  "选择结束 K 线，点击生成 K 线形态 · Esc 取消": "Choose the last bar and click to create a bars pattern · Esc to cancel",
  "同根 K 线同时触及止盈止损，按止损计算": "Both levels touched in the same bar; stop is assumed first",
  "点击添加下一段": "Click to add the next segment", "Enter 或双击完成": "Enter or double-click to finish", "右键撤销上一端点": "Right-click to undo the last point",
  "左肩": "Left Shoulder", "头部": "Head", "右肩": "Right Shoulder",
  "截图并保存到桌面": "Take a screenshot and save to Desktop",
  "截图已经保存在桌面": "Screenshot saved to Desktop",
  "截图已经保存在桌面，但复制到剪贴板失败，请重试": "Screenshot saved to Desktop, but copying to clipboard failed. Please try again.",
  "图表截图失败，请重试": "Chart screenshot failed. Please try again.",
  "绘图设置": "Drawing settings", "已更新绘图": "Drawing updated", "端点": "Point", "时间 (UTC+8)": "Time (UTC+8)",
  "隐藏此画线": "Hide drawing", "显示此画线": "Show drawing",
  "隐藏当前会话 AI 画线": "Hide AI drawings in this conversation",
  "切换 K 线绘制": "Next chart drawing",
  "显示当前会话 AI 画线": "Show AI drawings in this conversation",
  "当前会话 AI 画线已隐藏": "AI drawings hidden in this conversation",
  "当前会话 AI 画线已显示": "AI drawings shown in this conversation",
  "画线已隐藏，点击画布可恢复": "Drawing hidden. Click the chart to restore it.",
  "画线已显示": "Drawing shown", "AI 画线显示与字号": "AI drawing visibility and text size",
  "添加文字": "Add text", "＋ 添加文字": "+ Add text",
  "水平线设置": "Horizontal line settings", "样式": "Style", "坐标": "Coordinates",
  "参数": "Inputs", "上方偏差": "Upper deviation", "下方偏差": "Lower deviation",
  "偏差带计算方式": "Bands calculation mode", "标准差": "Standard deviation", "百分比": "Percentage",
  "偏差带倍数": "Bands multiplier", "显示上下轨": "Show bands", "上下轨颜色": "Band color",
  "价格档数": "Number of rows", "价值区域成交量 (%)": "Value area volume (%)", "柱状图宽度 (%)": "Profile width (%)",
  "行布局": "Rows layout", "行数": "Number of rows", "每行跳动数": "Ticks per row",
  "完整": "Complete", "缺失部分使用图表周期": "Missing bars use chart timeframe", "使用图表周期": "Using chart timeframe", "加载中": "Loading",
  "上涨成交量颜色": "Up volume color", "下跌成交量颜色": "Down volume color", "显示 POC": "Show POC",
  "时间吸附到已有 K 线，价格由行情数据计算。": "Time snaps to an available bar. Prices are calculated from market data.",
  "使用上方偏差": "Use upper deviation", "使用下方偏差": "Use lower deviation",
  "来源": "Source", "收盘价": "Close", "开盘价": "Open", "最高价": "High", "最低价": "Low",
  "基准线": "Base", "上轨": "Upper", "下轨": "Lower",
  "基准线颜色": "Base color", "上轨颜色": "Upper color", "下轨颜色": "Lower color",
  "线宽": "Line width", "线型": "Line style", "填充不透明度": "Fill opacity", "向右延长": "Extend right",
  "起点时间 (UTC+8)": "Start time (UTC+8)", "终点时间 (UTC+8)": "End time (UTC+8)",
  "两个端点只选择 K 线区间，价格由回归计算。": "The points select the bar range. Prices are calculated by regression.",
  "回归趋势至少需要两根有效 K 线": "Regression trend requires at least two valid bars",
  "选择结束 K 线，点击后自动计算回归通道": "Choose the last bar, then click to calculate the regression channel",
  "前两点已确定": "First two points set",
  "移动鼠标选择第三点，调整叉口与方向，点击完成": "Move to the third point to adjust the fork width and direction, then click to finish",
  "移动鼠标选择第二点，点击确定第一段": "Move to the second point and click to set the first leg",
  "线条": "Line", "线条颜色": "Line color", "斜体": "Italic", "确认": "OK", "关闭": "Close",
  "起点已确定": "Start point set", "Esc 取消": "Esc to cancel",
  "横向移动鼠标设置循环间隔，点击完成": "Move horizontally to set the cycle interval, then click to finish",
  "移动鼠标设置半周期和振幅，点击完成": "Move to set the half-period and amplitude, then click to finish",
  "两个端点必须选择不同时间": "The two anchors must have different times",
  "文字对齐": "Text alignment", "文字垂直对齐": "Vertical text alignment", "文字水平对齐": "Horizontal text alignment",
  "顶部": "Top", "中间": "Middle", "底部": "Bottom", "居左": "Left", "居中": "Center", "居右": "Right",
  "左": "Left", "中心": "Center", "右": "Right",
  "#1(价格)": "#1 (Price)", "已更新水平线": "Horizontal line updated",
  ...ENGLISH_DRAWING_TOOLS,
  // The shared Traditional Chinese normalizer maps 預設 back to 默认.
  "默认折线": "Preset polyline",
  "光标": "Cursor", "趋势线工具": "Trend tools", "江恩和斐波那契工具": "Gann and Fibonacci tools",
  "形态": "Patterns", "预测和测量工具": "Projection tools", "几何形状": "Geometric shapes",
  "注释工具": "Annotation tools", "绘图": "Drawing", "文本": "Text",
  "K线绘图工具": "Drawing tools", "K线绘图画布": "Drawing canvas",
  "表情分类": "Emoji categories", "笑脸和人物": "Smileys & people", "动物和自然": "Animals & nature",
  "食物和饮料": "Food & drink", "活动": "Activities", "旅行": "Travel & places",
  "物品": "Objects", "符号": "Symbols", "旗帜": "Flags",
  "添加到收藏": "Add to favorites", "从收藏移除": "Remove from favorites", "收藏的绘图工具": "Favorite drawing tools",
  "按住鼠标拖动绘制": "Click and drag to draw",
  "连续点击设置端点；右键撤销上一端点；双击、Enter 或 Esc 完成；折线点击起点闭合": "Click to add points; right-click to undo the last point; double-click or press Enter or Esc to finish. For a polyline, click the first point to close it.",
  "快速测量（Shift + 点击或拖动）": "Measure (Shift + click or drag)",
  "框选放大（点击起点和终点，或拖动框选）": "Zoom in (click two points or drag to select an area)",
  "磁吸到K线价格": "Magnet mode: snap to OHLC prices", "保持绘图模式": "Stay in drawing mode",
  "锁定全部绘图": "Lock all drawings", "解锁全部绘图": "Unlock all drawings",
  "隐藏全部绘图": "Hide all drawings", "显示全部绘图": "Show all drawings",
  "展开隐藏绘图选项": "Drawing visibility options",
  "隐藏AI绘图": "Hide AI drawings", "隐藏手动绘图": "Hide manual drawings",
  "隐藏数据标注": "Hide data annotations", "隐藏仓位线": "Hide position lines", "隐藏计划线": "Hide plan lines",
  "清空本会话所有绘图": "Remove all drawings in this session",
  "移除所有绘图": "Remove all drawings",
  "清空本会话所有绘图？": "Remove all drawings in this session?",
  "本会话的手动绘图、AI 绘图及历史记录都将被永久删除，其他会话不受影响。此操作无法撤销。": "All manual drawings, AI drawings, and drawing history in this session will be permanently deleted. Other sessions will not be affected. This cannot be undone.",
  "取消": "Cancel", "确认清空": "Remove all", "清空": "Clear", "确定": "OK",
  "绘图选项": "Drawing options", "恢复默认": "Restore defaults", "选择颜色": "Color",
  "隐藏绘图工具栏（重新选中图形可恢复）": "Hide drawing toolbar (select the drawing again to restore)",
  "选择样式": "Line style", "实线": "Solid line", "点线": "Dotted line", "虚线": "Dashed line",
  "选择线宽": "Line width", "锁定": "Lock", "解锁": "Unlock", "删除": "Remove",
  "可见范围": "Visibility", "趋势线样式": "Trend line style", "延伸": "Extend",
  "左侧延长线": "Extend left", "向右延长线": "Extend right", "左侧延长线, ...": "Extend left, ...", "不延伸": "None",
  "短虚线": "Dashed line", "点虚线": "Dotted line", "厚度": "Thickness", "线条样式": "Line style",
  "档位线": "Level lines",
  "逆时针": "Counterclockwise", "完整圆": "Full circles",
  "扇线": "Fan lines", "弧线": "Arcs", "范围和比率": "Range and ratio",
  "网格": "Grid", "半径线": "Radius line", "边界线": "Boundary lines", "连接线": "Connector", "边框": "Border",
  "趋势幅度已确定": "Trend range set", "基准线已确定": "Baseline set",
  "起始时间已确定": "Starting time set", "趋势时间已确定": "Trend duration set", "扇形起点已确定": "Fan origin set",
  "移动鼠标选择第三点作为 0 位，点击完成": "Move to the third point for level 0, then click to finish",
  "移动鼠标选择趋势终点，点击确定第一段": "Move to the trend end and click to set the first segment",
  "移动鼠标选择 1 倍通道起点，点击完成": "Move to the level 1 channel origin and click to finish",
  "移动鼠标选择第二点，点击确定通道方向": "Move to the second point and click to set the channel direction",
  "横向移动鼠标设置时间间隔，点击完成": "Move horizontally to set the time interval and click to finish",
  "移动鼠标选择时间投射起点，点击完成": "Move to the time projection origin and click to finish",
  "移动鼠标选择第二点，点击确定趋势时间": "Move to the second point and click to set the trend duration",
  "移动鼠标设置价格和时间范围，点击完成": "Move to set the price and time range and click to finish",
  "背景填充": "Background", "背景不透明度": "Background opacity", "显示档位": "Levels", "显示价格": "Prices",
  "模板": "Template", "模板名称": "Template name", "保存为模板": "Save as template", "模板保存失败": "Could not save template",
  "重命名": "Rename", "绘图名称": "Drawing name", "在以下时间周期显示": "Show on the following intervals",
  "最大周期不能小于最小周期": "Maximum interval must be at least the minimum",
  "秒": "Seconds", "分钟": "Minutes", "小时": "Hours", "天": "Days", "周": "Weeks", "月": "Months",
  "恢复默认文本样式": "Restore default text style", "文本输入": "Edit text", "关闭文本输入": "Close text editor",
  "请输入内容…": "Enter text…", "每行一行表格，用 | 分隔列": "Enter one row per line; separate columns with |",
  "粘贴 https:// 图片链接": "Paste an HTTPS image URL", "文本颜色": "Text color", "背景颜色": "Background color",
  "透明背景": "Transparent background", "字体大小": "Font size", "加粗": "Bold",
  "缩小": "Zoom out", "撤销绘图": "Undo drawing", "重做绘图": "Redo drawing",
  "磁吸已开启": "Magnet mode on", "磁吸已关闭": "Magnet mode off",
  "弱磁铁": "Weak magnet", "强磁铁": "Strong magnet", "吸附到指标": "Snap to indicators", "磁铁模式": "Magnet mode",
  "全部绘图已锁定": "All drawings locked", "全部绘图已解锁": "All drawings unlocked",
  "绘图已隐藏": "Drawings hidden", "绘图已显示": "Drawings visible", "已移动选项栏": "Toolbar moved",
  "已恢复默认样式": "Default style restored", "已恢复默认文本样式": "Default text style restored",
  "已更新颜色": "Color updated", "已更新文本颜色": "Text color updated", "已更新文本背景": "Text background updated",
  "已更新字体大小": "Font size updated", "已更新线条样式": "Line style updated", "已更新线宽": "Line width updated",
  "已加粗文本": "Bold text enabled", "已取消加粗": "Bold text disabled",
  "绘图已锁定": "Drawing locked", "绘图已解锁": "Drawing unlocked",
  "已取消起点，请点击图表重新设置": "First point removed; click the chart to set it again",
  "已调整端点": "Point adjusted", "已移动绘图": "Drawing moved",
  "请点击图表确定价格锚点": "Click the chart to set the price anchor", "请点击图表放置文本": "Click the chart to place text",
  "请选择小于 20 MB 的图片": "Choose an image smaller than 20 MB",
  "图片已载入": "Image loaded", "点击图表放置": "Click the chart to place it",
  "无法载入图片": "Unable to load image", "图片已放置": "Image placed", "请输入文本内容": "Enter text",
  "图片过大或格式不支持": "The image is too large or its format is not supported",
  "点击继续，双击、Enter 或 Esc 完成": "Click to add points; double-click or press Enter or Esc to finish",
  "点击起点闭合": "Click the first point to close the shape",
  "第二个端点已设置": "Second point set",
  "线段已确定": "Baseline set",
  "中轴线已确定": "Centerline set",
  "移动鼠标调整矩形宽度，点击完成": "Move the pointer to adjust the rectangle width, then click to finish",
  "移动鼠标选择终点，点击确定中轴线": "Move to the end point and click to set the centerline",
  "上下移动鼠标放置水平边界，点击完成": "Move up or down to place the horizontal boundary, then click to finish",
  "上下移动鼠标放置反向边界，点击完成": "Move up or down to place the opposite-slope boundary, then click to finish",
  "上下移动鼠标调整通道宽度，点击完成": "Move the pointer up or down to adjust the channel width, then click to finish",
  "移动鼠标选择终点，点击确定线段": "Move to the end point and click to set the baseline",
  "移动鼠标选择第三个端点，再次点击完成": "Move to the third point and click to finish",
  "移动鼠标选择第二个端点，再次点击确定一边": "Move to the second point and click to set the first side",
  "右键撤销上一端点": "Right-click to undo the last point",
  "价格锚点已设置": "Price anchor set",
  "移动鼠标选择标签位置，再次点击后输入注释": "Move to the label position, click, then enter a note",
  "100% 端点已设置": "100% point set",
  "移动鼠标展开 0% 端点，再次点击完成": "Move to the 0% point and click to finish",
  "再次点击继续": "Click again to continue", "移动鼠标选择终点，再次点击完成": "Move to the end point and click to finish",
  "已确定文本": "Text saved", "已取消文本输入": "Text entry canceled", "已关闭文本输入": "Text editor closed",
  "已删除绘图": "Drawing removed", "已完成": "Completed", "已撤销绘图": "Drawing undone", "已重做绘图": "Drawing redone",
  "本会话所有绘图及历史记录已清空": "All drawings and drawing history in this session removed",
  "请点击绘图线条或控制点": "Click a drawing or a control point", "已放大": "Zoomed in", "已缩小": "Zoomed out",
  "当前图表全部 AI 标注已缩小": "All AI annotation text on this chart made smaller",
  "当前图表全部 AI 标注已放大": "All AI annotation text on this chart made larger",
  "账户持仓与委托线": "Position and order lines", "AI 策略绘图": "AI strategy drawings", "AI 文字标注字号调节": "AI annotation font size controls",
  "暂无成交量数据": "No volume data", "请输入图片链接": "Enter an image URL",
  "项目": "Item", "数值": "Value", "价格": "Price", "目标": "Target", "止损": "Stop",
});

// Match complete UI templates, retaining numbers, symbols, and user-provided
// identifiers. This intentionally does not replace arbitrary Chinese fragments.
function translatePart(source) {
  if (!/\p{Script=Han}/u.test(source)) return source;
  if (Object.hasOwn(PHRASES, source)) return PHRASES[source];
  let match;
  if ((match = /^计算周期 (\w+)$/.exec(source))) return `Calculation timeframe ${match[1]}`;
  if ((match = /^低周期覆盖 (\d+)\/(\d+)$/.exec(source))) return `Lower-timeframe coverage ${match[1]}/${match[2]}`;
  if ((match = /^已确定 (\d+) \/ 5 段$/.exec(source))) return `${match[1]} of 5 segments set`;
  if ((match = /^(启用档位|档位颜色|档位|最小周期|最大周期) (\d+)$/.exec(source))) return `${({ 启用档位: 'Enable level', 档位颜色: 'Level color', 档位: 'Level', 最小周期: 'Minimum interval', 最大周期: 'Maximum interval' })[match[1]]} ${match[2]}`;
  if ((match = /^(价格|时间) #(\d+)$/.exec(source))) return `${match[1] === '价格' ? 'Price' : 'Time'} #${match[2]}`;
  if ((match = /^(收藏|取消收藏|展开)(.+)$/.exec(source))) {
    const term = PHRASES[match[2]];
    if (term) return match[1] === "展开" ? `Open ${term}` : `${match[1] === "收藏" ? "Add" : "Remove"} ${term} ${match[1] === "收藏" ? "to" : "from"} favorites`;
  }
  if ((match = /^(.+)输入$/.exec(source)) && PHRASES[match[1]]) return `Edit ${PHRASES[match[1]]}`;
  if ((match = /^(颜色|文本颜色|背景颜色) (#[\da-f]+)$/i.exec(source))) return `${({ 颜色: "Color", 文本颜色: "Text color", 背景颜色: "Background color" })[match[1]]} ${match[2]}`;
  if ((match = /^(\d+) 像素$/.exec(source))) return `${match[1]} px`;
  if ((match = /^依次点击图表设置 (\d+) 个端点；完成后可拖动端点调整$/.exec(source))) return `Click the chart to set ${match[1]} ${match[1] === "1" ? "point" : "points"}; drag the points to adjust after drawing`;
  if ((match = /^已设置 (\d+)(?:\/(\d+))? 个端点$/.exec(source))) return match[2] ? `${match[1]} of ${match[2]} points set` : `${match[1]} ${match[1] === "1" ? "point" : "points"} set`;
  if ((match = /^第 (\d+) 个端点已设置（共 (\d+) 个）$/.exec(source))) return `Point ${match[1]} of ${match[2]} set`;
  if ((match = /^移动鼠标选择第 (\d+) 个端点，再次点击继续$/.exec(source))) return `Move to point ${match[1]} and click to continue`;
  if ((match = /^已取消第 (\d+) 个端点，前 (\d+) 个端点已保留$/.exec(source))) return `Point ${match[1]} removed; ${match[2]} ${match[2] === "1" ? "point" : "points"} retained`;
  if ((match = /^清空(.+)的所有绘图？$/.exec(source))) return `Remove all drawings from ${translateScope(match[1])}?`;
  if ((match = /^(.+)的手动绘图、AI 绘图及历史记录都将被永久删除，其他分屏不受影响。此操作无法撤销。$/.exec(source))) return `All manual drawings, AI drawings, and drawing history in ${translateScope(match[1])} will be permanently deleted. Other chart panes will not be affected. This cannot be undone.`;
  if ((match = /^([\d.]+)(天|小时|分钟|秒)$/.exec(source))) return `${match[1]}${({ 天: "d", 小时: "h", 分钟: "m", 秒: "s" })[match[2]]}`;
  if ((match = /^([\d,—]+)根K线 \((.+)\), 距离: ([\d,]+) px$/.exec(source))) return `${match[1]} bars (${match[2]}), Distance: ${match[3]} px`;
  return null;
}

function translateScope(scope) {
  return scope.replace(/^副图\s*/, "indicator pane ").replace(/^分屏\s*/, "chart pane ").replace(/^主图$/, "the main chart");
}

export function englishDrawingText(value, section = false) {
  const source = String(value), trimmed = source.trim();
  const exact = section ? ENGLISH_DRAWING_SECTIONS[trimmed] : translatePart(trimmed);
  if (exact != null) return source.replace(trimmed, () => exact);
  // Status segments are separated by spaced middots; Elliott labels use
  // unspaced middots and are translated intact above.
  if (trimmed.includes(" · ")) {
    const parts = trimmed.split(" · ").map(translatePart);
    if (parts.every(part => part != null)) return source.replace(trimmed, () => parts.join(" · "));
  }
  return null;
}
