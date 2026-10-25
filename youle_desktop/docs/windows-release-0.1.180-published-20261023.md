# Windows 0.1.180 正式发布

2026-10-23，任务 M1-461。用户在本会话审核三语文案后明确批准上传发布。负责人：会话01a164ff-3696-7421-bc73-5a94c0e12260。

## 版本与发布范围

- Windows x64 Web3渠道`haolo_windows_web3`，版本`0.1.180`；采用M1-460已签名安装包，源码`65ca437c88b46e14297083cb4ff2afd23752c7d0`，未重打或改变包字节。源码已推送origin/dev。
- 发布记录ID：`d054a548-eb67-401d-9382-9b69cd09a682`。服务端记录的发布时间（北京时间）：`2026-10-23 03:36:20`；本机公网最终校验时间（北京时间）：`2026-10-23 03:37:54`。机器回执分别保留服务端发布时间、本机响应接收时间及验收时间的原始UTC值。
- 使用现有更新管理接口，经严格主机校验的SSH隧道上传安装包并发布，再上传对应blockmap。凭据从当前API配置读入内存，不输出、不写入包或Git，不修改本机凭据文件。
- 保留普通更新方式，178／179升级到180不强制；低于178继续沿用原强制升级门槛。180不重复提示，标准版渠道`haolo_windows`未改变。
- 相关Windows打包与后台发布会话均已结束；生产API／独立Worker的前批回执complete。本会话只发布客户端更新渠道，没有部署或重启API、Worker、官网静态页面、行情网关及模型网关。

## 已审核并发布的三语文案

### 简体中文

- 优化交易计划展示，入场方向、止损和各级止盈更清晰；分析完成后自动调整图表视野，减少关键价位显示不全。
- 统一 AI 斐波那契回撤线样式，优化形态轮廓、绘图动画和文字避让，提升图表可读性。
- 修复 KDJ、RSI 等 AI 指标标注导致 K 线、成交量柱出现空档或显示异常的问题。
- 新增账户收益曲线，优化今日盈亏刷新及收益数据同步状态展示。
- 改善币安账户绑定、断开后重新绑定及网络异常恢复，完善错误提示。
- 优化分析结果同步与重试，改善计划卡片和较长历史记录的恢复。
- 修复部分 Windows 环境下桌面快捷方式缺失或失效的问题。

### English

- Improve trading plan displays with clearer entry direction, stop-loss levels, and take-profit targets. Automatically fit the chart after analysis to keep key price levels in view.
- Unify the styling of AI Fibonacci retracements and improve pattern outlines, drawing animations, and label placement for clearer charts.
- Fix gaps and display issues in candlesticks and volume bars caused by AI annotations for indicators such as KDJ and RSI.
- Add an account performance chart and improve daily PnL refreshes and performance data synchronization status.
- Improve Binance account linking, relinking after disconnection, recovery from network errors, and error messages.
- Improve analysis result synchronization and retries, and restore plan cards and longer history records more reliably.
- Fix missing or broken desktop shortcuts in some Windows environments.

### 繁體中文

- 優化交易計畫顯示，進場方向、停損及各級停利更清晰；分析完成後自動調整圖表視野，減少關鍵價位顯示不全。
- 統一 AI 斐波那契回撤線樣式，優化形態輪廓、繪圖動畫及文字避讓，提升圖表可讀性。
- 修復 KDJ、RSI 等 AI 指標標註導致 K 線、成交量柱出現空檔或顯示異常的問題。
- 新增帳戶收益曲線，優化今日盈虧更新及收益資料同步狀態顯示。
- 改善幣安帳戶綁定、中斷後重新綁定及網路異常恢復，完善錯誤提示。
- 優化分析結果同步與重試，改善計畫卡片及較長歷史記錄的恢復。
- 修復部分 Windows 環境下桌面捷徑遺失或失效的問題。

## 安装包与验收

- [官网最新版入口](https://haolo.com/api/app-updates/windows/latest/download?arch=x64&client_variant=haolo_windows_web3)；[0.1.180正式安装包](https://assets.haolo.com/app-updates/windows/0.1.180/haolo_windows_web3/haolo_desktop-0.1.180-Setup.exe)。
- 文件：`haolo_desktop-0.1.180-Setup.exe`，247805400字节（236.33 MiB）。
- SHA-256：`e91937faacae1475bcdf3cbef14b342bbc9fccd25d2a5e426d1375909a875d8f`。
- 上传前重新验证主程序、Chrome native host、卸载程序副本与安装器四项EV签名，固定Keroro证书、SHA256、EV策略和可信时间戳均有效。
- 继承M1-460的5220/5220测试、类型与正式构建、1370构建输入、297包内／324附加资源、47内核、实际封装启动及399文件更新回环验收；[构建记录](windows-release-0.1.180-M1-460-20261023.md)。
- 生产更新检查177／178／179／180均符合预期；公开三语文案与审核稿规范化换行后逐字一致。官网脚本指向Web3更新渠道，latest入口302指向新包。
- CDN及公布的备用下载地址Range 206通过，首1MiB与本地包逐字节一致；生产blockmap与本地相同并可解析。公网完整下载247805400字节，SHA256与已签名候选一致。
- API／独立Worker均保持`b30e530c3ee1f9b31ac8d37f5e0339be0b72e1ae`，各1062安装文件哈希与其release manifest一致，唯一消费者、17策略及completeplan1／smtpairing1协议就绪。发布前后API、两个Worker、PostgreSQL、Redis和入口容器身份、镜像、启动戳与重启数未变，双方回执保持complete。
- 未执行真实Windows系统安装、用户登录或线上付费分析；不将包与下载验收称为这些行为。

## 回执与本地文件

- [脱敏机器回执](verification/windows-release-0.1.180-published-20261023.json)。审核稿哈希：`1c7ae1b9694f17cd08decc79a6b43d2574fb3165f36c83cc8fde435d6a0b602e`。
- 本轮完整证据：`D:/haolo_windows_web3/.cache/publish-0.1.180-20261023/`；公开下载副本为其中`public-download-verified.exe`。
- 桌面安装包、blockmap、签名报告、SHA256及旧版备份保持；本次发布记录与三语更新说明同步放入`C:/Users/joiec/Desktop/好咯最新安装包/haolo_windows_web3/`。
