# Windows → macOS 融合后审查（2026-09-19）

关联任务：M2-020。审查 Mac `5ef4844..c58b0e6`，Windows 来源 `2534b02..7792b54`。用户随后要求彻底修复，R1/R2 及关联模拟图层恢复缺口已在工作区修复并完成验收。以下保留修复前审查证据；修复与验收见末节。

## 完整性结论

重新 fetch 后 Windows dev 仍为 `7792b545652cf14bc3d70201c17cc3a3202d80ba`。7 个非 EV 提交均有 `cherry-pick -x` 对应，没有发现漏合的提交或文件。

对来源区间的 111 个变更文件重新核对：10 个签名专属文件按要求排除，其余 101 个文件中 72 个与上游逐字节一致，29 个存在平台配置、既有 Mac 修复、文档或测试适配差异。逐项复核 range-diff，未发现意外丢弃的非签名改动。此前融合报告统计的 73/28 是最终 QA 脚本调整前的快照；72/29 为本次修复前审查时的快照。

EV 提交 `e16b575` 未移植：7 个新增签名文件不存在，已有 Windows 工作流、AGENTS 和图标脚本与融合前一致；package.json 没有引入签名 hook 或强制签名配置。两个版本文件与原始未提交备份逐字节一致，仅保留用户原有 0.1.169 → 0.1.170 改动。Mac 原生运行时、媒体任务 GPT 路由、安全存储降级、更新强制策略和日历周期兼容仍在。

## R1 · P2：历史恢复重置预警模拟视图（已修复）

位置：`src/renderer/trading-expert-market.ts:12472–12477`，特别是 `updateChartData({ resetViewport: true })`。

触发条件：已有可用但需要刷新的历史缓存和预警模拟；首次 REST 刷新失败，稍后进入新增的 `recoverMarketHistory`。该路径无条件重置视口。`updateChartData` 虽然先聚焦模拟，随后执行初始行情视口覆盖它，模拟触发点被移出可见区域。此前增量刷新依据 `this.candles.length === 0` 决定是否重置，已有缓存时不会执行这次重置。

Electron 实际图表、亮暗两主题都复现：恢复前视口 `427..532`，触发点 x=955.42；补齐 500 根后变成 `400..505`，触发点 x=1234.58，超过画布宽度 1096。模拟序列仍存在；显式重新聚焦后回到 x=955.42。

同一恢复路径还有衔接缺口：如果启动时模拟图层已被卸载，恢复后虽市场/周期匹配且状态仍在，却没有调用正常快照提交路径的模拟同步，图层保持不可见；补调 `syncAlertSimulationForCurrentContext` 后显示恢复。旧增量恢复也缺少此同步，因此这一点记录为相关既有缺口，不单独计为本次新回归。

建议：让恢复路径区分首次空图、已有手动视图和模拟视图；恢复完行情后按当前上下文重新挂载/聚焦模拟，避免无条件初始视口覆盖模拟范围。这是随 Windows 上游带入的恢复逻辑问题，非 cherry-pick 冲突造成的遗漏。

## R2 · P2：Option 字母快捷键未适配 Mac（已修复）

位置：`src/renderer/trading-chart-navigation.ts:582–588`。

新增的重置、对数、百分比和反转快捷键使用 `event.altKey` 加 `event.key === 'r'/'l'/'p'/'i'`。macOS 常用美式布局下 Option 会改变字符：本机 Carbon `UCKeyTranslate` 实测 Option+R/L/P 分别产生 `®/¬/π`，Option+I 是重音键。因此实际按键不能匹配这些分支。

在 Electron 实际生产图表中注入对应的 DOM 按键值，亮暗两主题的 4 项动作均不触发；以现有 QA 使用的 `key: 'l', altKey: true` 作对照，对数切换成功。此前 Electron `sendInputEvent` QA 直接传入字母，未覆盖键盘布局转换。本轮没有向用户正在使用的应用发送系统级按键。

建议：字母组合快捷键按 `event.code` 或统一的平台快捷键归一化处理，并覆盖 Mac Option 字符及重音键。这是本次移植的 Mac 适配遗漏；按钮和右键菜单仍可操作。

## 修复前审查验证与证据

- 桌面定向回归 173/173；模型真实 Mac 捆绑内核、差分下载和网络补充回归 37/37，共 210 项通过。
- 网关背压、共享编码/压缩、缓存回归 13 项通过、1 项真实 Redis 环境跳过；合计 223 通过、0 失败、1 跳过。
- 独立 Electron 生产图表 fixture 双主题复现上述问题及对照，Renderer 错误为 0；这些检查验证当前错误行为，并非修复验收。
- `git diff --check` 通过。没有重复运行上一轮已通过的全量测试、类型检查与构建；本轮未修改业务代码。

证据：`.git/windows-sync-review-20260919-{integrity.json,targeted.log,runtime-network.log,gateway.log,ui.log,keymap.txt,keymap.c}`。可复跑的界面诊断脚本与报告：`youle_desktop/.cache/windows-sync-review-20260919/{probe.cjs,report.json}`；使用现有 Vite 5183 隔离 fixture 和 Electron，行情与模型请求均为本地模拟。

原有三个未提交文件保留。本轮新增本报告和台账记录，未提交、推送、打包、部署或重启现有客户端；现有 0.1.170 DMG 仍不包含本次融合。真实香港线路、Redis、目标设备和 M2-013 历史生产验收边界保持。

## 修复与验收（2026-09-19）

- R1：`recoverMarketHistory` 在响应完成后判断当前市场/周期是否已有已绘制数据；仅空图初始化视口，已有图表保留用户缩放及时间、价格坐标。所有成功行情写入统一在初始视口操作完成后同步模拟：已挂载的重新聚焦，已卸载的重新挂载并聚焦，市场/周期不匹配的保持卸载。避免初始视口覆盖模拟，也补齐普通更新与恢复入口的重挂缺口。
- R2：Option 字母快捷键优先按 `KeyboardEvent.code` 识别物理键，支持 `®/¬/π/Dead/ˆ`。保留旧事件的字符回退及命名键处理；输入框、IME、Ctrl/Meta 组合和未聚焦图表的全局事件仍隔离。主图与分屏共用控制器。
- 新增 7 个行为回归，覆盖恢复后的数据、操作顺序、模拟上下文隔离和真实 Mac 字符值；相关定向测试 85/85。桌面全量 3174 项：3168 通过、0 失败、0 取消、6 Windows 平台条件跳过；类型检查、194 modules 前端构建、脚本语法与 `git diff --check` 通过。构建仍有既有大 chunk 提示。
- 新增持久脚本 `scripts/trading-market-recovery-mac-qa.cjs`，在独立 Electron 生产图表 fixture 中完成亮暗主题验证。两主题均确认缓存恢复、显式重置、空图恢复后模拟序列和“模拟触发”标签可见，恢复后的触发 x=955.42，画布宽 1096；不匹配市场不挂载。查看两主题截图，标签及指引线正常。
- 亮暗主题 × 线性/对数/百分比共 6 组手动视图：补入 400 根历史后，原蜡烛和价格锚点的 x/y 像素偏差均为 0，手动价格轴保持。亮暗主题 × 主图/分屏共 4 组 Option R/L/P/I、IME/组合键/输入框隔离通过。快捷键在生产 DOM 注入 macOS 对应字符值；坐标轴使用 Electron 原生滚轮输入，未向用户客户端发送系统按键。Renderer 错误为 0；退出后的离屏 GPU mailbox 日志不影响断言与截图。

可复跑方式：在 `youle_desktop` 启动 `pnpm exec vite --host 127.0.0.1 --port 5183`，另一个终端运行 `pnpm exec electron scripts/trading-market-recovery-mac-qa.cjs`。fixture 使用本地模拟行情，无真实账户操作。报告与截图：`.cache/trading-market-recovery-mac-qa/{report.json,light-recovered.png,dark-recovered.png}`。测试日志：`.git/windows-sync-fix-20260919-{targeted,full,typecheck,build,ui}.log`。

本次已完成本地源码修复与验收；Windows EV 排除及原有版本改动保持。修复验收阶段未重新打包；用户随后要求版本 170 用于发布，现已生成包含融合和修复的新 Universal 候选包，详见 `docs/mac-release-0.1.170-20260919.zh-CN.md`，旧测试包已归档。尚未推送、安装或部署。M2-020 的真实线路/登录与历史生产验收仍是独立外部依赖，不因本次修复而标记整个任务完成。
