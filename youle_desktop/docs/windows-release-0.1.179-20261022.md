# Windows 0.1.179 正式发布

日期：2026-10-22。任务 M1-435；用户指定版本 179 并授权打包后发布官网。负责人：会话 `01a15fa6-45fa-75e3-8c09-60c9920eec4e`。

## 范围与源码

- Windows x64 Web3 渠道 `haolo_windows_web3`，版本固定 `0.1.179`，生产业务地址 `https://haolo.com`。
- 基于已推送 `2d867e503e5d00d1a8169dc08a95af788638c76b`，包含指标审阅证据一致性、左右侧条件预案与绘图播放、K 线拖动惯性改进；纳入原开发会话已完成且经本轮复核的 AppData 历史恢复修复。
- 本次修正测试源码切片对 CRLF 的兼容，重新编译自有 Chrome native host。原语音资源本地换行状态保留，47 项内核运行资源原始哈希全部匹配。
- 全量测试 4888/4888、TypeScript、生产构建通过。首次环境失败与修正后回归日志分别保存于 `.cache/release-0.1.179-20261022/`。Vite 保留大 chunk 提示。
- 客户端发布不重启或部署 API、策略 Worker、官网静态页面、邀请中心与模型网关。发布前核验依赖版本与公开更新渠道；使用 SSH 路线提交既有更新管理接口。
- 0.1.178 升级到本版为普通更新；保留此前低于 0.1.178 必须升级的门槛。
- 300 条画线重压性能仍有两项未达到严格 P95 < 50ms 门槛，不宣称全部负载稳定 60fps；详见 `trading-chart-momentum-20261022.zh-CN.md`。

## 公开更新说明

### 简体中文

- 优化 K 线拖动与松手后的惯性滑行，减少起步延迟，改善横向滚动和密集画线场景的响应。
- 左右侧分析在暂无合格机会时展示条件预案、待满足条件与确认步骤；交易偏好保留左侧和右侧，历史自动偏好兼容为右侧。
- 修复减少动态效果设置下 AI 绘图一次性出现的问题，保持逐个对象展示。
- 修复部分 Windows AppData 重定向环境中新任务历史读取失败的问题。
- 统一指标联合审阅的证据名单，减少合法分析结果因证据引用遗漏而失败。

### English

- Improve chart dragging, momentum after release, horizontal scrolling, and responsiveness with dense drawing layers.
- Show conditional watch plans, unmet conditions, and confirmation steps when left-side or right-side analysis has no qualified opportunity. Trading preferences now offer left and right; legacy automatic preferences use right-side behavior.
- Show AI drawings one object at a time when reduced motion is enabled.
- Fix new-task history loading in Windows environments with redirected AppData paths.
- Align evidence lists used in combined indicator review to prevent valid results from failing because of omitted evidence references.

### 繁體中文

- 優化 K 線拖曳與放手後的慣性滑行，減少起步延遲，改善橫向捲動與密集畫線時的反應。
- 左右側分析在暫無合格機會時顯示條件預案、待滿足條件與確認步驟；交易偏好保留左側與右側，歷史自動偏好相容為右側。
- 修復減少動態效果設定下 AI 繪圖一次出現的問題，維持逐個物件顯示。
- 修復部分 Windows AppData 重新導向環境中新任務歷史讀取失敗的問題。
- 統一指標聯合審閱的證據清單，減少合法分析結果因證據引用遺漏而失敗。

## 发布验收

进行中。构建与签名输出位于 `release/build-0.1.179-production-20261022/`；完成后登记候选完整 SHA、安装包大小／哈希、签名、包内同一性、启动、更新回环及官网实际下载结果。
