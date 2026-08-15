# Haolo 交易策略 Skill 解耦进度台账

> 台账类型：状态表 + 追加式完成记录  
> 创建日期：2026-08-14  
> 执行基线：`docs/trading-strategy-skill-decoupling-plan.zh-CN.md`  
> 上位基线：`docs/trading-expert-realtime-ai-execution-plan.zh-CN.md`

## 1. 记录规则

1. 本文是本次改造唯一的专项进度台账；执行计划只定义做什么，不在其中覆盖历史完成记录。
2. 开始任务时更新状态表为 `进行中`，并在追加日志记录范围、基线和回滚点。
3. 完成任务时必须追加一条完成记录，包含实际文件、验收证据、测试命令与结果、风险、回滚方式和遗留项。
4. 没有实际执行的测试不得写“通过”；未运行必须明确写“未运行”及原因。
5. 新失败必须阻断完成。只有已在基线中登记且能独立复现的既有失败，才可作为“非本次新增”记录，但仍需给出后续责任任务。
6. 涉及 UI 时，浅色与暗色以及 default、hover、active/selected、focus、open、loading、disabled、expired、error 等相关状态必须一并记录。
7. 涉及任一策略切流时，必须记录新旧链路等价结果和功能开关回滚验证。
8. 日志只追加，不修改或删除旧记录；事实有误时追加“更正记录”并引用原记录 ID。
9. 不记录虚构百分比。整体状态以已通过阶段出口的任务为准。

状态枚举：`未开始 | 进行中 | 受阻 | 已完成 | 已取消`。

## 2. 当前摘要

- 当前阶段：P0–P6、M1-139、M1-144、M1-145、M1-166 至 M1-196 已完成；新增复杂策略和指标继续使用既有扩展契约接入，P7 内部验证与发布门禁保持不变。
- 当前工作：MACD、布林带、均线、RSI、KDJ 与 VPVR 均已作为独立 Indicator Skill 接入指标目录；VPVR 分析严格使用当前可见窗口，结论只输出支撑、阻力和成交量分布洞察。
- 下一任务：继续 TSK-P7-001 内部验证周期门禁；其前置条件仍是持续无新增回归。
- 当前代码状态：缠论、订单流、波浪理论、威科夫、谐波形态、传统图表形态、裸K分析、道氏理论、江恩理论、ICT/SMC、SMT、MACD、均线、布林带、RSI、KDJ 和 VPVR 均通过统一 Registry/Coordinator 运行；VPVR 复用原生 96 档主图覆盖层，独立 Skill 不读取订单流结果，也不向可见报告注入执行方案。
- 当前发布状态：开发代码、Skill 校验与 Vite 生产构建已通过；Windows 安装包、真实行情人工烟测和 100%/125%/150% 实机视觉验收尚未执行，因此未签署发布结论。
- 当前阻塞：无代码阻塞；P7 的观察期和安装版验收是主动发布门禁，不能伪造为已完成。
- 总回滚点：设置 `HAOLO_TRADING_STRATEGY_RUNTIME_MODE=legacy` 可透明回到原适配器执行；也可用 `HAOLO_DISABLED_TRADING_STRATEGIES` 让指定策略回退兼容链路，菜单入口不中断。

## 3. 阶段出口状态

| 阶段 | 目标 | 状态 | 出口结论 |
|---|---|---|---|
| P0 | 基线、特征测试、开关与回滚 | 已完成 | 基线、总开关、按策略开关、shadow/legacy 语义均有自动测试 |
| P1 | 协议、Registry、官方 Manifest、Legacy Adapter | 已完成 | 四个隔离策略包通过严格 Schema 与 skill 校验 |
| P2 | Coordinator、通用 IPC、旧接口桥接 | 已完成 | 通用 list/classify/run/cancel 落地，旧 IPC 仅作兼容转发 |
| P3 | Renderer 注册驱动与公共生命周期 | 已完成 | 菜单、分类、运行、任务和失败隔离由注册目录驱动 |
| P4 | 四策略按序切流 | 已完成 | 四个旧确定性管线未重写，均经 Adapter 接入统一协调器 |
| P5 | ExecutionPlanV1 与标准报告 | 已完成 | 触发、确认、止损、目标、风险、有效期和取消条件由确定性价位生成 |
| P6 | 声明式测试策略与自然语言生成兼容契约 | 已完成 | 第五策略纵切测试与草稿歧义/默认值/回放门禁通过 |
| P7 | 旧分支清理、打包和发布门禁 | 未开始 | 依方案保留兼容桥至内部验证周期结束；Vite 构建已通过但不代替安装版验收 |

## 4. 稳定任务状态

| 任务 ID | 任务 | 状态 | 依赖 | 最近证据记录 |
|---|---|---|---|---|
| TSK-P0-001 | 文档和架构决策冻结 | 已完成 | 无 | LOG-20260814-002 |
| TSK-P0-002 | 建立改造前特征基线 | 已完成 | TSK-P0-001 | LOG-20260814-004 |
| TSK-P0-003 | 功能开关与回滚路径 | 已完成 | TSK-P0-002 | LOG-20260814-006 |
| TSK-P1-001 | 协议与 Schema | 已完成 | TSK-P0-003 | LOG-20260814-007 |
| TSK-P1-002 | Registry 与四个官方 Manifest | 已完成 | TSK-P1-001 | LOG-20260814-007 |
| TSK-P1-003 | 四个 Legacy Adapter | 已完成 | TSK-P1-002 | LOG-20260814-007 |
| TSK-P2-001 | Strategy Coordinator | 已完成 | TSK-P1-003 | LOG-20260814-008 |
| TSK-P2-002 | 通用 IPC 和旧接口桥接 | 已完成 | TSK-P2-001 | LOG-20260814-008 |
| TSK-P3-001 | 动态策略目录 | 已完成 | TSK-P2-002 | LOG-20260814-009 |
| TSK-P3-002 | 公共分类、分析和任务生命周期 | 已完成 | TSK-P3-001 | LOG-20260814-009 |
| TSK-P4-CHAN | 缠论切流 | 已完成 | TSK-P3-002 | LOG-20260814-010 |
| TSK-P4-WYCKOFF | 威科夫切流 | 已完成 | TSK-P4-CHAN | LOG-20260814-010 |
| TSK-P4-WAVE | 波浪理论切流 | 已完成 | TSK-P4-WYCKOFF | LOG-20260814-010 |
| TSK-P4-ORDERFLOW | 订单流切流 | 已完成 | TSK-P4-WAVE | LOG-20260814-010 |
| TSK-P5-001 | ExecutionPlan Builder | 已完成 | TSK-P4-ORDERFLOW | LOG-20260814-011 |
| TSK-P5-002 | 标准报告与图表关联 | 已完成 | TSK-P5-001 | LOG-20260814-011 |
| TSK-P5-003 | 执行安全边界 | 已完成 | TSK-P5-002 | LOG-20260814-011 |
| TSK-P6-001 | 声明式测试策略 | 已完成 | TSK-P5-003 | LOG-20260814-012 |
| TSK-P6-002 | 自然语言生成兼容性契约 | 已完成 | TSK-P6-001 | LOG-20260814-012 |
| TSK-P7-001 | 删除旧分支 | 未开始 | TSK-P6-002 | - |
| TSK-P7-002 | 打包与安装版验收 | 未开始 | TSK-P7-001 | - |
| M1-139 | 谐波形态 Strategy Skill 完整链路 | 已完成 | TSK-P6-002 | LOG-20260814-016、017 |
| M1-144 | 传统图表形态学 Strategy Skill 完整链路 | 已完成 | TSK-P6-002 | LOG-20260815-026、027 |
| M1-145 | 下降三角形误报与历史信号生命周期修复 | 已完成 | M1-144 | LOG-20260815-028 |
| M1-165 | 裸K分析 Price Action Strategy Skill 完整链路 | 已完成 | M1-145,TSK-P6-002 | LOG-20260815-029、030 |
| M1-166 | 裸K蜡烛形态子引擎与圈选标注 | 已完成 | M1-165 | LOG-20260815-031、032 |
| M1-167 | 裸K客户端入口统一接线修复 | 已完成 | M1-166 | LOG-20260815-033 |
| M1-168 | 裸K椭圆跨进程落图修复 | 已完成 | M1-167 | LOG-20260815-034 |
| M1-169 | 裸K形态标签双主题与碰撞避让 | 已完成 | M1-168 | LOG-20260815-035 |
| M1-170 | 裸K形态标签目标指引虚线 | 已完成 | M1-169 | LOG-20260815-036 |
| M1-171 | 底分型及全部多K组合形态椭圆可见性 | 已完成 | M1-170 | LOG-20260815-037 |
| M1-172 | 裸K椭圆分数坐标、线宽与组合范围收敛 | 已完成 | M1-171 | LOG-20260815-038 |
| M1-173 | 裸K形态收盘确认语义与执行门禁 | 已完成 | M1-172 | LOG-20260815-039 |
| M1-174 | 道氏理论独立趋势环境 Skill 完整链路 | 已完成 | M1-173,TSK-P6-002 | LOG-20260815-040 |
| M1-175 | 江恩理论独立 Skill 与三子引擎完整链路 | 已完成 | M1-174,TSK-P6-002 | LOG-20260815-041 |
| M1-176 | 江恩文字与方格/轮中轮箱体碰撞避让 | 已完成 | M1-175 | LOG-20260815-042 |
| M1-177 | ICT/SMC 独立 Skill 与零迁移接入 | 已完成 | M1-176,TSK-P6-002 | LOG-20260815-043 |
| M1-178 | SMT 独立 Skill 与 Hyperliquid 只读对照行情 | 已完成 | M1-177 | LOG-20260815-044 |
| M1-179 | MACD 指标 Skill、经典形态与背离链路 | 已完成 | M1-178,TSK-P6-002 | LOG-20260815-045 |
| M1-180 | MACD 背离绘图协议错误修复 | 已完成 | M1-179 | LOG-20260815-046 |
| M1-181 | MACD 主图/副图绘图坐标解耦 | 已完成 | M1-180 | LOG-20260815-047 |
| M1-182 | 布林带 Indicator Skill 完整链路 | 已完成 | M1-181,TSK-P6-002 | LOG-20260815-048 |
| M1-183 | 均线 Indicator Skill 完整链路 | 已完成 | M1-182,TSK-P6-002 | LOG-20260815-049 |
| M1-184 | 均线金叉/死叉真实交点锚定修复 | 已完成 | M1-183 | LOG-20260815-050 |
| M1-185 | RSI Indicator Skill 完整链路 | 已完成 | M1-184,TSK-P6-002 | LOG-20260815-051 |
| M1-186 | RSI 副图小圆点与虚线引导标注 | 已完成 | M1-185 | LOG-20260815-052 |
| M1-187 | RSI 副图文字下排与空白区避让 | 已完成 | M1-186 | LOG-20260815-053 |
| M1-196 | VPVR Indicator Skill、可见窗口分析与纯信息结论 | 已完成 | M1-195,TSK-P6-002 | LOG-20260815-058 |

## 5. 四策略切流矩阵

| 验收项 | 缠论 | 威科夫 | 波浪理论 | 订单流 |
|---|---|---|---|---|
| 旧链路基线 Fixture | 已完成 | 已完成 | 已完成 | 已完成 |
| Manifest/Adapter 契约 | 已完成 | 已完成 | 已完成 | 已完成 |
| Request Router 等价 | 已完成 | 已完成 | 已完成 | 已完成 |
| 数据准备等价 | 已完成 | 已完成 | 已完成 | 已完成 |
| 确定性结果等价 | 已完成 | 已完成 | 已完成 | 已完成 |
| Provider 请求/约束等价 | 已完成 | 已完成 | 已完成 | 已完成 |
| DrawingPatch 等价 | 已完成 | 已完成 | 已完成 | 已完成 |
| 报告与 ExecutionPlanV1 | 已完成 | 已完成 | 已完成 | 已完成 |
| 取消/超时/错误 | 已完成 | 已完成 | 已完成 | 已完成 |
| 历史绘图/上下文恢复 | 已完成 | 已完成 | 已完成 | 已完成 |
| 浅色/暗色与缩放 | 主题源码/自动测试通过；缩放未实测 | 同左 | 同左 | 同左 |
| 真实行情烟测 | 未运行 | 未运行 | 未运行 | 未运行 |
| 开关回滚冒烟 | 自动测试通过 | 自动测试通过 | 自动测试通过 | 自动测试通过 |
| 专项 + 全仓 + 构建 | 已完成 | 已完成 | 已完成 | 已完成 |

## 6. 测试证据索引

| 证据 ID | 日期 | 范围 | 命令/环境 | 结果 | 关联任务 |
|---|---|---|---|---|---|
| DOC-001 | 2026-08-14 | 文档存在、互链、任务 ID、围栏、空白检查 | PowerShell 结构校验；`git diff --check` | 21/21 任务 ID 一致，围栏闭合，无空白错误 | TSK-P0-001 |
| BASE-001 | 2026-08-14 | 四策略专项与旧链路特征 | Node Test Runner，8 个目标文件 | 127/127 通过 | TSK-P0-002 |
| BASE-002 | 2026-08-14 | TypeScript 基线 | `pnpm run typecheck` | 通过 | TSK-P0-002 |
| BASE-003 | 2026-08-14 | 全仓基线 | `pnpm test` | 2047 项：2042 通过、5 个既有源码契约失败 | TSK-P0-002 |
| BASE-004 | 2026-08-14 | 生产构建基线 | `pnpm run build` | 通过；仅既有大 chunk 提示 | TSK-P0-002 |
| MIG-001 | 2026-08-14 | 四策略、生命周期、绘图、布局、旧链路特征和新运行时目标回归 | Node Test Runner，目标文件 | 57/57 通过 | TSK-P1–P6 |
| MIG-002 | 2026-08-14 | Strategy Runtime、声明式第五策略、安全和自然语言门禁 | `node --test test/trading-strategy-runtime.test.mjs` | 13/13 通过 | TSK-P0-003、TSK-P1、P2、P5、P6 |
| MIG-003 | 2026-08-14 | 动态菜单和会话持久化 | Node Test Runner，布局与 transcript 文件 | 54/54 通过 | TSK-P3 |
| MIG-004 | 2026-08-14 | 生命周期与 Drawing Gateway | Node Test Runner，lifecycle 与 drawing 文件 | 42/42 通过 | TSK-P3、P4、P5 |
| MIG-005 | 2026-08-14 | 最终全仓回归 | `node --test --test-reporter=spec` | 2060 项：2055 通过、5 个失败；失败集合与 BASE-003 完全相同，新增失败 0 | TSK-P0–P6 |
| MIG-006 | 2026-08-14 | TypeScript 最终门禁 | `pnpm run typecheck` | 通过 | TSK-P0–P6 |
| MIG-007 | 2026-08-14 | Vite 生产构建与资源打包声明 | `pnpm run build` | 通过；81 modules，仅既有大 chunk 提示 | TSK-P6、TSK-P7-002（部分证据） |
| MIG-008 | 2026-08-14 | 差异空白与补丁完整性 | `git diff --check` | 通过；仅 LF/CRLF 工作树提示 | TSK-P0–P6 |
| HARM-001 | 2026-08-14 | 谐波五形态、多空镜像、PRZ/确认、绘图、执行计划、Registry/Coordinator/Renderer 全链路 | Node Test Runner，谐波、旧四策略、运行时、生命周期、绘图、持久化、布局和主题文件 | 186/186 通过；谐波专项 9/9 | M1-139 |
| HARM-002 | 2026-08-14 | M1-139 全仓回归 | `node --test --test-reporter=tap` | 2088 项：2083 通过、5 个失败；失败集合与 BASE-003 完全相同，新增失败 0 | M1-139 |
| HARM-003 | 2026-08-14 | Skill/类型/语法/构建/差异门禁 | `quick_validate.py`、`pnpm run typecheck`、`node --check`、`pnpm run build`、`git diff --check` | 全部通过；89 modules，仅既有大 chunk 与 LF/CRLF 提示 | M1-139 |
| SKILL-001 | 2026-08-14 | 四个官方 Skill 包结构 | skill-creator `quick_validate.py`，逐目录执行 | 4/4 通过 | TSK-P1-002 |
| UI-001 | 2026-08-14 | 策略页仅展示 Catalog 策略卡片、文案、侧栏入口与双主题契约 | Node Test Runner；`pnpm run typecheck`；`pnpm run build`；`git diff --check` | 目标专项 34/34、侧栏入口 1/1、TypeScript、构建和差异检查通过 | M1-131 |
| UI-002 | 2026-08-14 | 策略页新增指标/量化分类、隐藏插件分类及双主题交互状态 | Node Test Runner；`pnpm run typecheck`；`pnpm run build`；Windows Electron Visual QA；`git diff --check` | UI/主题专项 28/28、TypeScript、构建、8/8 视觉截图和差异检查通过 | M1-138 |
| CHART-001 | 2026-08-15 | 传统图表形态初版完整链路 | 图表形态专项、组合、全仓、类型、语法、Skill 与构建门禁 | 专项 14/14、组合 157/157；全仓 2135 项中 2130 通过、5 个 BASE-003 已知失败；新增失败 0 | M1-144 |
| CHART-002 | 2026-08-15 | 下降三角形几何、突破归属、信号生命周期、当前候选选择、报告/绘图/ExecutionPlan | 图表形态专项、9 文件组合回归、全仓 TAP、`node --check`、`pnpm run typecheck`、`pnpm run build`、空白检查 | 专项 18/18、组合 161/161；两次最终全仓复核均为 2139 项中 2134 通过、5 个 BASE-003 已知失败；新增稳定失败 0；类型/语法/91 modules 构建通过 | M1-145 |
| GANN-001 | 2026-08-15 | 江恩角度/方格/轮中轮/Square of Nine、收盘隔离、路由、注册、执行、双主题与全仓回归 | 江恩+运行时+Skill 专项、全部 `trading-*`、全仓 TAP、`quick_validate.py`、`node --check`、类型检查、Vite build、空白检查 | 专项/注册/主题 29/29；交易全域 464/464；全仓 2178 项中 2173 通过、5 个 BASE-003 既有失败，新增失败 0；Skill/语法/类型/97 modules 构建通过 | M1-175 |
| GANN-002 | 2026-08-15 | 江恩文字避让方格、轮中轮、K 线与相邻文字 | 绘图+江恩定向测试、全部 `trading-*`、类型检查、Vite build | 定向 49/49；交易全域 465/465；类型检查和 97 modules 构建通过，仅保留既有大 chunk 提示 | M1-176 |
| ICTSMT-001 | 2026-08-15 | ICT/SMC、SMT、Hyperliquid 只读网关、未收盘隔离、快照指纹、Registry、双主题和订单流零迁移 | ICT/SMT 定向、订单流组合、全部 `trading-*`、全仓 TAP、两项 Skill `quick_validate.py`、`node --check`、类型检查、Vite build、边界差异检查 | 新增定向 6/6；订单流/运行时/Skill 组合 42/42；交易全域 471/471；全仓 2185 项中 2180 通过、5 个 BASE-003 既有失败，新增失败 0；两项 Skill/语法/类型/101 modules 构建通过 | M1-177,M1-178 |
| MACD-001 | 2026-08-15 | MACD 公式、八大经典形态、常规/隐藏背离、未收盘隔离、自动副图、Registry、ExecutionPlan、双主题 | MACD 定向、全部 `trading-*`、全仓 TAP、`quick_validate.py`、`node --check`、类型检查、Vite build、空白检查 | 新增定向 6/6；交易全域 477/477；全仓 2187 项中 2182 通过、5 个 BASE-003 既有失败，新增失败 0；Skill/语法/类型/103 modules 构建/空白检查通过 | M1-179 |
| MACD-002 | 2026-08-15 | 看跌类背离绘图颜色角色协议错误修复 | 四种背离 Drawing Gateway 定向、MACD 专项、全部 `trading-*`、`node --check`、类型检查、Vite build、开发版冷重启 | MACD 7/7；交易全域 478/478；协议/语法/类型/103 modules 构建通过；看涨/看跌及常规/隐藏背离全部使用受支持角色，开发版已加载 | M1-180 |
| MACD-003 | 2026-08-15 | MACD 形态、背离连线和文字从 K 线主图迁移到 MACD 副图，主图仅保留执行价位 | 指标坐标协议、负值/零轴、四类背离、Renderer 原生副图系列/标记、旧主图残留清理、MACD 专项、绘图/运行时组合、全部 `trading-*`、类型检查、Vite build、空白检查、开发版冷重启 | MACD 专项 8/8；定向组合 65/65；交易全域 479/479；TypeScript、103 modules production build、空白检查通过；亮暗主题复用成对策略语义 Token | M1-181 |
| BOLL-001 | 2026-08-15 | 布林带共享公式、低带宽/扩张、连续收盘突破、沿带运行、M 顶/W 底、假突破、未收盘隔离、受控主图绘图、指标目录与标准执行方案 | 布林带定向、MACD/运行时/Skill 组合、全部 `trading-*`、全仓 Node Test Runner、Skill `quick_validate.py`、`node --check`、类型检查、Vite build、空白检查 | 布林带专项 9/9；指标/运行时组合 40/40；交易全域 488/488；全仓 2202 项中 2197 通过、5 个失败严格等于 BASE-003，新增失败 0；Skill/语法/类型/105 modules 构建/空白检查通过 | M1-182 |
| MA-001 | 2026-08-15 | SMA5/20/60 共享公式、多空排列、持续确认金叉/死叉、均线压缩后有序发散、MA20 回踩、未收盘隔离、主图标注、指标目录与标准执行方案 | 均线定向、全部 `trading-*`、全仓 Node Test Runner、Skill `quick_validate.py`、`node --check`、类型检查、Vite build、空白检查 | 均线专项 10/10；交易全域 498/498；全仓 2212 项中 2207 通过、5 个失败严格等于 BASE-003，新增失败 0；Skill/语法/类型/107 modules 构建/空白检查通过 | M1-183 |
| MA-002 | 2026-08-15 | 金叉/死叉 MA5/MA20 线性插值交点、交点锚点与收盘确认位置解耦、自动文字避让 | 均线定向、全部 `trading-*`、全仓 TAP、Skill `quick_validate.py`、`node --check`、类型检查、Vite build、空白检查 | 均线专项 11/11；交易全域 499/499；全仓 2213 项中 2208 通过、5 个失败严格等于 BASE-003，新增失败 0；Skill/语法/类型/107 modules 构建/空白检查通过 | M1-184 |
| RSI-001 | 2026-08-15 | Wilder RSI(14) 共享公式、70/30、50 中轴、趋势区间、四类背离、多空失败摆动、未收盘隔离、RSI 副图绘制、指标目录、双主题与标准执行方案 | RSI/运行时定向、全部 `trading-*`、全仓 TAP、Skill `quick_validate.py`、`node --check`、类型检查、Vite build、空白检查 | RSI+运行时定向 23/23；RSI 专项 9/9；交易全域 508/508；全仓 2222 项中 2217 通过、5 个失败严格等于 BASE-003，新增失败 0；Skill/语法/类型/109 modules 构建/空白检查通过 | M1-185 |
| RSI-002 | 2026-08-15 | RSI 副图标记点缩小、真实值锚定、自动偏移文字和细虚线回指 | RSI/运行时定向、全部 `trading-*`、全仓 TAP、Skill `quick_validate.py`、协议/管线 `node --check`、类型检查、Vite build、空白检查 | RSI+运行时定向 23/23；交易全域 508/508；全仓 2222 项中 2217 通过、5 个失败严格等于 BASE-003，新增失败 0；Skill/语法/类型/109 modules 构建通过 | M1-186 |
| RSI-003 | 2026-08-15 | RSI 标签文字下方分层、局部空白评分、横向换列、文字锚点隐形和虚线回指 | RSI/运行时定向、全部 `trading-*`、全仓 TAP、Skill `quick_validate.py`、协议/管线 `node --check`、类型检查、Vite build、空白检查 | RSI+运行时定向 24/24；交易全域 508/508；全仓 2223 项中 2218 通过、5 个失败严格等于 BASE-003，新增失败 0；Skill/语法/类型/109 modules 构建通过 | M1-187 |
| RSI-004 | 2026-08-15 | RSI 虚线引导防交叉：真实点与标签锚点固定同一时间坐标，保留下方分层与小圆点 | RSI/KDJ/运行时定向、全部 `trading-*`、全仓 dot、Skill 校验、语法、类型、构建、空白检查 | RSI/KDJ/运行时定向 33/33；交易全域 518/518；全仓 2232 项中 2227 通过、5 个失败严格等于 BASE-003，新增失败 0；双 Skill/语法/类型/111 modules 构建/空白检查通过 | M1-188 |
| KDJ-001 | 2026-08-15 | KDJ(9,3,3) 同源递推、K/D 精确交点、80/20/钝化/J 极值、D 线四类背离、未收盘隔离、KDJ 副图标注、指标目录、双主题与标准执行方案 | KDJ 专项、RSI/运行时组合、全部 `trading-*`、全仓 dot、Skill `quick_validate.py`、`node --check`、类型检查、Vite build、空白检查 | KDJ 专项 9/9；RSI/KDJ/运行时 33/33；交易全域 518/518；全仓 2232 项中 2227 通过、5 个失败严格等于 BASE-003，新增失败 0；Skill/语法/类型/111 modules 构建通过 | M1-189 |
| KDJ-002 | 2026-08-15 | 修复 RSI/KDJ 同时间戳引线触发 Lightweight Charts 严格升序断言；生成端 1 秒微偏移，Renderer 通用升序兜底 | RSI/KDJ 专项、指标/运行时定向、全部 `trading-*`、全仓 spec、双 Skill 校验、`node --check`、类型检查、Vite build、空白检查、开发版冷重启 | RSI/KDJ 19/19；定向组合 60/60；交易全域 518/518；全仓 2232 项中 2227 通过、5 个失败严格等于 BASE-003，新增失败 0；Skill/语法/类型/111 modules 构建通过 | M1-190 |
| KDJ-003 | 2026-08-15 | KDJ 指标卡展示元数据中文化：标题、简介和默认提示统一中文 | KDJ/Skill 目录定向、Skill 校验、类型检查、Vite build、空白检查、开发版冷重启 | 定向 18/18；Skill 校验、TypeScript、111 modules 构建和空白检查通过；分析引擎与双主题样式未改 | M1-191 |
| VPVR-001 | 2026-08-15 | VPVR 独立 Skill、原生 96 档算法同源、当前可见窗口、POC/VAH/VAL/HVN/LVN、支撑阻力与纯成交分布结论 | VPVR+运行时专项、全部 `trading-*`、全仓 TAP、Skill `quick_validate.py`、`node --check`、类型检查、Vite build、空白检查、开发版冷重启 | VPVR+运行时 21/21；交易全域 528/528；全仓 2238 项中 2233 通过、5 个失败严格等于 BASE-003，新增失败 0；Skill/语法/类型/114 modules 构建通过 | M1-196 |

测试记录必须至少包含：

- 精确命令；
- 运行目录和必要环境；
- 通过/失败/跳过数量；
- 失败用例名称；
- 是否为改造前已登记失败；
- Fixture、截图、报告或日志路径；
- 对应 Git 提交或工作树状态。

## 7. 风险与阻塞台账

| 风险/阻塞 ID | 状态 | 描述 | 影响任务 | 缓解/解除条件 |
|---|---|---|---|---|
| RISK-001 | 已缓解，待实盘复核 | 订单流有独立真实数据和多周期上下文，过度通用化可能改变失败关闭语义 | TSK-P1-003、TSK-P4-ORDERFLOW | Adapter 直接复用原 pipeline/data hooks，自动回归通过；P7 前仍需真实行情烟测 |
| RISK-002 | 已缓解 | 大型 `main.ts/main.mjs` 中四套分支同时替换会放大回归 | TSK-P2、TSK-P3、TSK-P4 | 新发送路径已统一；旧分支只作一个验证周期的兼容壳，功能开关可回滚 |
| RISK-003 | 监控中 | 模型自然语言不稳定，不适合全文黄金比较 | TSK-P0-002、TSK-P4 | 固定 Provider Stub；比较协议、候选、证据和价格来源 |
| RISK-004 | 监控中 | 动态策略资源在生产打包或 ASAR 内不可见 | TSK-P7-002 | `package.json` 已包含资源且 Vite build 通过；仍须 Windows 安装版/ASAR 验收 |
| RISK-005 | 已缓解 | 执行方案可能生成看似具体但无证据的价位 | TSK-P5 | 价位仅取确定性 action levels，缺少账户权益时数量为 null，默认 wait 且无下单路径 |

## 8. 追加式进度日志

### LOG-20260814-001：启动 TSK-P0-001

- 日期：2026-08-14。
- 状态变化：`未开始 → 进行中`。
- 用户目标：以最小风险将缠论、订单流、波浪理论和威科夫解耦为未来策略广场兼容的 Strategy Skill，并要求原功能等价、分阶段严格测试、独立进度记录和统一可落地执行方案。
- 本次范围：只创建执行计划和进度台账，更新上位架构记录；不修改业务代码。
- 已确认边界：确定性引擎、模型综合判断、Drawing Gateway、用户手工绘图隔离和默认不下单保持不变。
- 初始回滚点：Git `dev` 分支当前业务实现；本轮仅文档变更。
- 下一步：完成文档链接、结构、差异和工作区校验后，将 TSK-P0-001 标记为已完成。

### LOG-20260814-002：完成 TSK-P0-001

- 日期：2026-08-14。
- 状态变化：`进行中 → 已完成`。
- 目标与实际范围：完成四策略 Skill 解耦、未来策略广场兼容、统一 `ExecutionPlanV1`、逐阶段测试门禁和独立进度记录方案；未修改任何业务代码。
- 修改文件：
  - `docs/trading-strategy-skill-decoupling-plan.zh-CN.md`；
  - `docs/trading-strategy-skill-decoupling-progress.zh-CN.md`；
  - `docs/trading-expert-realtime-ai-execution-plan.zh-CN.md`。
- 验收证据：
  - 两份专项文档存在并互相引用；
  - 上位基线登记当前焦点、专项文档和 ADR-009；
  - 执行计划与进度台账各包含相同的 21 个稳定任务 ID，无遗漏或多余；
  - Markdown 代码围栏数量分别为 22 和 4，均闭合；
  - 工作区变更仅包含上述三份 Markdown 文档。
- 测试证据：执行 PowerShell 文档结构/引用/任务 ID 校验与 `git diff --check`；全部结构断言通过，`git diff --check` 无空白错误，仅报告仓库既有的 LF/CRLF 转换提示。
- 业务测试：未运行。原因是本任务只增加/更新 Markdown 文档，没有业务代码、Schema 或 UI 行为变更；严格业务测试从 TSK-P0-002 的改造前特征基线开始实际执行并登记。
- 新旧行为等价结论：业务代码未变，运行行为没有进入改造范围。
- 亮色/暗色结论：未修改 UI；计划已将双主题和完整交互状态列为后续硬门禁。
- 已知风险或遗留项：P0 尚未完成；必须先完成旧实现 Fixture、全仓测试基线和功能开关设计，之后才能增加运行时抽象。
- 回滚方式：删除两份新增专项文档，并撤销上位基线中的 2026-08-14 焦点、ADR-009 和进度日志；不涉及用户数据或业务状态。
- Git 状态：三份文档为本任务范围，未提交。
- 下一任务：TSK-P0-002 建立改造前特征基线。

### LOG-20260814-003：启动 TSK-P0-002

- 日期：2026-08-14。
- 状态变化：`未开始 → 进行中`。
- 目标与实际范围：先在现有四策略链路上建立路由、确定性结果、绘图协议、错误/取消和数据覆盖特征基线，再开始运行时解耦。
- 回滚点：现有四策略业务实现保持不变；本阶段新增测试不得要求新架构存在。
- 验收要求：四策略正常、边界、数据不足和取消路径有稳定证据；专项与全仓基线实际执行并记录。
- 下一步：盘点现有 Fixture/导出能力，补齐最小但足以锁定外部行为的特征测试。

### LOG-20260814-004：完成 TSK-P0-002

- 日期：2026-08-14。
- 状态变化：`进行中 → 已完成`。
- 修改文件：新增 `test/fixtures/trading-strategy-legacy-contract.json` 和 `test/trading-strategy-legacy-characterization.test.mjs`，业务实现未改。
- 验收证据：锁定四策略稳定 ID/顺序/mention、Prompt 源文件哈希、旧 IPC、engine/pipeline/router、独立图层、最大绘图预算、Renderer 四入口、订单流真实数据入口和波浪自动扩窗入口。
- 测试证据：四策略专项、生命周期、绘图、布局和新增特征测试合计 127/127 通过；`pnpm run typecheck` 通过；`pnpm run build` 通过。
- 全仓基线：`pnpm test` 共 2047 项，2042 通过、5 个改造前既有源码契约失败：集群画布退出、会话行双主题状态、暗色弹窗动作、资料菜单定位、视频专家确认方式。后续阶段不得增加失败数量或改变失败集合。
- 新旧行为等价结论：特征测试直接运行于旧实现，作为后续适配器和切流比较基线。
- 回滚方式：删除新增 Fixture 与特征测试；不涉及用户状态。
- 下一任务：TSK-P0-003 功能开关与回滚路径。

### LOG-20260814-005：启动 TSK-P0-003

- 日期：2026-08-14。
- 状态变化：`未开始 → 进行中`。
- 目标：实现默认开启的新策略运行时总开关、按策略开关和无副作用影子模式；迁移期保留旧 IPC 作为可验证回滚路径。
- 安全边界：影子模式不重复调用收费模型、不写会话、不绘图、不持久化；只允许比较本地确定性/协议结果。

### LOG-20260814-006：完成 TSK-P0-003

- 状态变化：`进行中 → 已完成`。
- 修改文件：新增 `src/main/trading-strategy-runtime/feature-flags.mjs`，在主进程通用运行入口接入总模式和按策略禁用判定。
- 验收证据：支持默认 `v1`、总回滚 `legacy`、无副作用契约校验 `shadow` 和 `HAOLO_DISABLED_TRADING_STRATEGIES`；回滚只切换执行链路，不隐藏或中断用户的策略菜单入口。
- 测试：MIG-002、MIG-005、MIG-006、MIG-008 通过；`legacy`、按策略禁用和 `shadow` 均有单元断言。
- 回滚：设置 `HAOLO_TRADING_STRATEGY_RUNTIME_MODE=legacy`，无需迁移或删除用户数据。

### LOG-20260814-007：完成 P1 协议、Registry 与四个官方 Skill

- 状态变化：TSK-P1-001/002/003 `未开始 → 已完成`。
- 修改文件：新增 `contracts.mjs`、`manifest-loader.mjs`、`registry.mjs`、`legacy-adapter.mjs`、四个 `builtins/*-adapter.mjs`，以及 `resources/trading-strategies/builtins/{chan,order-flow,wave,wyckoff}` 的 `strategy.json`、`SKILL.md`、规则参考和 `agents/openai.yaml`；`resources/trading-strategies/README.zh-CN.md` 固化新策略接入规范。
- 验收证据：Manifest/Result/ExecutionPlan 严格拒绝未知字段、任意入口和越界资源路径；坏包隔离不拖垮其他策略；四包按历史顺序发现。
- Skill 规范验证：SKILL-001 为 4/4 通过。该结构由 skill-creator 规范决定，`SKILL.md` 保持短入口，细则下沉至 `references/rules.md`。
- 未修改边界：四套确定性引擎、Router、Provider Prompt 和行情准备算法没有重写。
- 回滚：删除新运行时目录和资源目录即可；旧源文件仍在。

### LOG-20260814-008：完成 P2 主进程统一协调器和兼容 IPC

- 状态变化：TSK-P2-001/002 `未开始 → 已完成`。
- 修改文件：新增 `coordinator.mjs`，更新 `src/main/main.mjs` 与 `src/main/preload.mjs`。
- 验收证据：新增 `tradingStrategy:list/classify/run/cancel`；旧四组 IPC 保留为单行兼容转发；Coordinator 对策略结果封装、验证并追加标准执行方案，直接问答仍保持原简洁响应。
- 安全：shadow 不重复调用模型；单策略异常隔离；公开 API 没有订单或密钥能力。
- 测试：MIG-001、MIG-002、MIG-005、MIG-006 通过。

### LOG-20260814-009：完成 P3 Renderer 注册驱动与公共生命周期

- 状态变化：TSK-P3-001/002 `未开始 → 已完成`。
- 修改文件：新增 `src/renderer/trading-strategy-runtime/{catalog,client,execution-plan-view}.ts`，更新 `main.ts`、`trading-expert-market.ts`、生命周期和绘图模块。
- 验收证据：策略菜单由打包 Manifest 自动发现并按 `sortOrder` 排序；发送链路只有一次策略识别和一次通用运行分派；损坏/禁用策略显式显示为不可点击并携带原因，其余策略可继续工作。
- 主题：禁用态使用语义 Token，浅色和暗色均覆盖；focus/open/hover/active 继续复用原菜单状态。未进行 Windows 100%/125%/150% 人工视觉验收，因此只记录源码和自动主题契约通过。
- 测试：MIG-003、MIG-004、MIG-005、MIG-006、MIG-007 通过。

### LOG-20260814-010：完成 P4 四策略切流

- 状态变化：TSK-P4-CHAN/WYCKOFF/WAVE/ORDERFLOW `未开始 → 已完成`。
- 实际方式：四个 Adapter 直接复用原 Router、pipeline、Provider 约束、数据 hooks 和 Drawing Patch；默认发送路径改走 Registry/Coordinator，旧专用函数仅留作验证周期兼容壳。
- 等价证据：旧链路哈希/入口 Fixture 未变，四策略目标回归、取消/错误/持久化和 Drawing Gateway 测试通过；全仓失败集合相对 BASE-003 新增 0。
- 特别风险：订单流真实数据、多周期和失败关闭逻辑未被通用层改写；本轮未调用实时市场/收费模型，P7 前需人工真实行情烟测。
- 回滚：全局 `legacy` 或按策略禁用，不影响其他策略。

### LOG-20260814-011：完成 P5 标准执行方案

- 状态变化：TSK-P5-001/002/003 `未开始 → 已完成`。
- 修改文件：新增 `execution-plan-builder.mjs`；缠论管线暴露其既有确定性 action levels；Coordinator 将验证后的计划写入结构化结果并附加至完整报告。
- 输出字段：市场前置条件、当前条件、偏好方向、入场触发、收盘/突破确认、止损与失效理由、分批目标、风险收益、最大风险规则、继续观察、有效期和取消条件。
- 安全结论：价位来自确定性 action levels 并支持 tick size 归一；缺少账户权益时 `suggestedQuantity=null`；计划默认是条件式 `wait`，没有 `placeOrder/createOrder`、交易账户密钥或自动下单 IPC。
- 测试：ExecutionPlan Schema、价格来源、tick、报告附加和无下单路径均在 MIG-002/MIG-005 中通过。

### LOG-20260814-012：完成 P6 声明式第五策略和自然语言兼容门禁

- 状态变化：TSK-P6-001/002 `未开始 → 已完成`。
- 修改文件：新增 `declarative-rules.mjs`、`declarative-adapter.mjs` 和 `strategy-draft.mjs`；Drawing Gateway 支持 `ai/strategy/<strategyId>` 隔离图层及语义颜色。
- 验收证据：测试中的第五个均线策略只提供 Manifest+Rules，不增加宿主 adapter 分支，即完成注册、分类、OHLCV/SMA 分析、画线和 ExecutionPlan；未来数据 offset、任意颜色、任意文件路径均失败关闭。
- 自然语言生成边界：系统建议值、用户明确值、用户确认值可区分；存在未解决歧义、未确认默认值或未通过历史回放时，草稿不能编译为可运行策略。
- 结论：架构已经兼容 Haolo 客户端后续“自然语言 → 草稿 → 澄清 → 回放 → 确认 → 私有保存/发布”的产品链路，但本轮没有开放公开策略广场或第三方任意代码。

### LOG-20260814-013：P0–P6 最终验证与 P7 门禁结论

- 最终自动回归：2060 项，2055 通过、5 个失败；失败名称与 BASE-003 完全一致，新增失败为 0。一次中间运行中的并发视频测试出现环境性卡顿，单独复跑 1/1 通过，随后完整全仓复跑恢复为上述稳定结果。
- 既有失败：集群画布退出、会话行双主题状态、暗色弹窗动作、资料菜单定位、视频专家上传确认方式；本次策略改造未改变其集合。
- 工程门禁：TypeScript 通过；Vite 生产构建通过（81 modules，仅既有大 chunk 提示）；`git diff --check` 通过（仅 LF/CRLF 提示）；四个官方 Skill 包校验 4/4 通过。
- 未执行：真实行情/真实模型烟测、Windows 100%/125%/150% 实机视觉、Electron Windows 安装包/ASAR/升级/离线测试。原因是这些属于有外部环境或发布影响的 P7 验收，不能用源码测试替代。
- P7 决策：严格遵守计划中“至少一个内部验证周期后删除旧分支”的门槛，因此不提前删除兼容壳，也不把 P7 标记完成。当前改造代码已完成，但尚不签署可发布结论。
- 工作树：本次实现尚未提交；未触碰或清理与任务无关的用户改动。
- 下一任务：内部验证周期结束后执行 TSK-P7-001，再生成并安装 Windows 包完成 TSK-P7-002。

### LOG-20260814-014：完成 M1-131 策略页展示收口

- 日期：2026-08-14。
- 状态变化：M1-131 `进行中 → 已完成`；P7 状态不变。
- 目标与实际范围：按用户截图隐藏策略页中的所有通用技能卡片，只展示 Trading Strategy Catalog 生成的策略卡片，并把“我的技能”改为“策略”。
- 修改文件：`src/renderer/main.ts`、`test/trading-strategy-skill-library.test.mjs`、上位基线与本台账。
- 未修改边界：`mySkillsPlazaCards()` 仍完整组装本地技能与策略技能；技能刷新、市场技能加载、详情、安装、注册、运行时、Coordinator、Adapter、旧兼容 IPC 和插件页签均未删除或改写。新增 `strategySkillPlazaCards()` 只在策略页渲染前按受信任的 `trading-strategy:` 卡片前缀过滤可见集合。
- 验收证据：策略页签显示“策略”；空状态显示“暂无策略”；Haolo Desktop Release、Chrome、Documents、Find Skills、GitHub、LaTeX、Presentations、ripgrep、Spreadsheets 等非策略卡片不再进入该页可见列表；缠论、订单流、波浪理论、威科夫继续由 Catalog 自动发现并保持点击/键盘打开交易专家入口。
- 测试证据：
  - `node --test test/trading-strategy-skill-library.test.mjs test/trading-strategy-runtime.test.mjs test/page-home-navigation.test.mjs test/theme-appearance.test.mjs`：34/34 通过；
  - `node --test --test-name-pattern='the sidebar skills action opens the existing skills and plugins page' test/conversation-list-minimal.test.mjs`：1/1 通过；
  - `pnpm run typecheck`：通过；
  - `pnpm run build`：通过，85 modules，仅既有大 chunk 提示；
  - `git diff --check`：通过，仅工作树 LF/CRLF 提示。
- 既有失败复核：一次包含 `conversation-list-minimal.test.mjs` 全文件的组合运行共 31 项，30 通过、1 个“minimal row hover, selected, focus, menu, and status states share light-dark tokens”失败；该失败属于 BASE-003 已登记的会话行双主题源码审计，本任务未修改对应 CSS，且与策略页入口相关的单项定向复跑通过。
- 新旧行为等价结论：策略卡片调用链和全部非策略技能后台能力保持不变；唯一产品行为变化是策略页不再渲染非策略卡片。
- 亮色/暗色与交互状态结论：没有新增或修改 CSS、颜色、背景、边框、阴影或主题分支；卡片继续复用现有浅色/暗色 default、hover、active、focus-visible 与键盘可访问状态，相关主题契约通过。Windows 100%/125%/150% 人工视觉未运行，仍保留为 P7 发布门禁。
- 已知风险或遗留项：P7 的真实行情、Windows 多缩放、安装包/ASAR 验收仍未运行；不影响本次纯展示收口完成结论。
- 回滚方式与回滚验证：将策略页数据源从 `strategySkillPlazaCards()` 恢复为 `mySkillsPlazaCards()` 并恢复文案即可重新展示全部技能；原技能逻辑未删除，无用户数据迁移。
- Git 提交/工作树状态：未提交；保留并避开当前工作树其他已有改动。
- 下一任务：继续等待内部验证周期后执行 TSK-P7-001，再进行 TSK-P7-002 Windows 安装版验收。

### LOG-20260814-015：完成 M1-138 策略页分类调整

- 日期：2026-08-14。
- 状态变化：M1-138 `进行中 → 已完成`；P7 状态不变。
- 目标与实际范围：在策略页可见分类栏增加“指标”和“量化”，隐藏“插件”入口；不删除或改写插件功能代码。
- 修改文件：`src/renderer/main.ts`、`src/renderer/styles.css`、`test/trading-strategy-skill-library.test.mjs`、上位基线与本台账。
- 未修改边界：插件页渲染、插件工作区加载、启停、删除、Chrome 管理和本地数据状态全部保留；策略 Catalog、Coordinator、Adapter、ExecutionPlan 和策略卡调用链不变。
- 验收证据：分类栏可见顺序为“策略 / 指标 / 量化”；插件页签仍存在于统一页签配置但以 `hidden: true` 过滤；指标与量化可正常切换并分别显示独立空状态，不会误加载技能市场或插件数据。
- 测试证据：
  - `node --test test/trading-strategy-skill-library.test.mjs test/page-home-navigation.test.mjs test/theme-appearance.test.mjs test/dark-button-visibility.test.mjs`：28/28 通过；
  - `pnpm run typecheck`：通过；
  - `pnpm run build`：通过，86 modules，仅既有大 chunk 提示；
  - `electron scripts/workspace-chrome-windows-visual-qa.mjs`：8/8 亮暗截图通过，策略页亮暗实图已人工核对；
  - `git diff --check`：通过，无空白错误。
- 新旧行为等价结论：策略页新增两个分类入口；插件只隐藏可见入口，底层能力与兼容链路保持原样。
- 亮色/暗色与交互状态结论：分类按钮覆盖 default、hover、active/selected、focus-visible 和 disabled；暗色 hover/active 使用现有主题 Token，亮暗截图均保持文字、背景、卡片和选中态清晰。
- 已知风险或遗留项：指标与量化当前没有已发布卡片，分别展示明确空状态；后续接入真实内容时应继续走注册目录而不是在页面硬编码业务卡片。P7 发布门禁不变。
- 回滚方式与回滚验证：移除两个新增页签和值类型，恢复插件页签的可见配置即可回到原导航；插件代码从未删除，无用户数据迁移。
- Git 提交/工作树状态：未提交；保留并避开当前工作树其他已有改动。
- 下一任务：继续等待内部验证周期后执行 TSK-P7-001，再进行 TSK-P7-002 Windows 安装版验收。

### LOG-20260814-016：启动 M1-139 谐波形态完整链路

- 日期：2026-08-14。
- 状态变化：M1-139 `未开始 → 进行中`；P7 状态不变。
- 目标与实际范围：使用已经落地的 Strategy Manifest/Registry/Coordinator/ExecutionPlan/Drawing Gateway 契约，新增谐波形态官方内置策略；自动识别并正确绘制经典 XABCD、PRZ、确认、失效、T1/T2，生成可执行但不自动下单的条件式方案。
- 调研与规则冻结：以 HarmonicTrader/Scott Carney 的公开原始资料为规则来源；v1 明确支持 Gartley、Bat、Butterfly、Crab、Deep Crab。Shark、5-0 因拓扑不同暂不混入，AB=CD 作为候选收敛条件；不把端点相似或模型主观判断当作合格形态。
- 安全边界：摆动点、比例、候选、PRZ、确认、失效和目标全部由确定性引擎计算；模型只能选择已有稳定候选 ID 并解释。绘图限定 `ai/strategy/harmonic` 与 `strategy-*` 语义颜色，不接触 DOM、网络、凭据或交易 IPC。
- 回滚点：不修改原四策略引擎和 Adapter；谐波可通过 `HAOLO_DISABLED_TRADING_STRATEGIES=harmonic` 单独禁用，或删除其 Manifest/Adapter 注册恢复到原四策略目录。
- 验收要求：五种形态正反例、镜像方向、比例容差、PRZ、Terminal Bar 后确认、无未来数据、Drawing Gateway 注入拒绝、ExecutionPlanV1、动态菜单/问答/行情/分屏生命周期、亮暗主题、Skill 校验、专项/全仓/类型/构建/差异检查全部留下实际证据。

### LOG-20260814-017：完成 M1-139 谐波形态完整链路

- 日期：2026-08-14。
- 状态变化：M1-139 `进行中 → 已完成`；P7 状态不变。
- 实际交付：新增独立 `harmonic` Strategy Skill、Manifest、知识规则、受信任 Adapter、请求路由、确定性 XABCD 引擎、模型受限复核管线、通用行情接入、自动绘图、双目标 `ExecutionPlanV1`、策略卡图标和可重复真实行情烟测脚本。策略由既有目录和 Registry 自动发现，主发送链路没有增加 `strategy.id === "harmonic"` 业务分支。
- 知识与算法：v1 仅支持 Gartley、Bat、Butterfly、Crab、Deep Crab 的多空镜像；逐项校验交替几何、B/XA、C/AB、D/XA、CD/BC、CD/AB 和 PRZ 收敛。常规 Crab 的极端 BC 投影从 2.618 起算，Deep Crab 保留 2.24–3.618；精确定义比率采用明示的 ±3% 实现容差。Shark、5-0 未被错误归类，AB=CD 不是独立入场信号。
- 确认与执行：到达 D/PRZ 只产生 `awaiting-confirmation`；只有 Terminal Bar 后的已收盘 K 线按方向穿越其高/低点才确认。绘图固定输出 XABCD、五点标签、PRZ、确认、PRZ 外失效、T1/T2 和形态摘要；T1/T2 为 D→A 的 38.2%/61.8%，标准方案包含前置条件、方向、触发、止损、两档分批止盈、风险收益、观察、有效期和取消条件，且不具备自动订单能力。
- 安全与隔离：模型只能从确定性候选 ID 中选择并解释，不能创建或移动点位、价格、PRZ、止损或目标；服务端 Drawing Gateway 只接受 `ai/strategy/harmonic` 和 `strategy-*` 语义颜色，跨图层与任意颜色注入均失败关闭。`HAOLO_DISABLED_TRADING_STRATEGIES=harmonic` 可单独禁用，原四策略引擎、Prompt 和 Adapter 未改写。
- 自动验收证据：
  - 谐波专项 9/9 通过，覆盖五形态多空镜像、比例/几何/PRZ 反例、D 点待确认、模型候选约束、精确绘图、双目标执行方案、路由、Registry/Coordinator/Renderer 完整链路；
  - 谐波与原四策略、运行时、旧链路特征、生命周期、Drawing Gateway、持久化、布局和双主题组合回归 186/186 通过；
  - 全仓 2088 项中 2083 通过、5 个失败，失败名称与 BASE-003 的集群画布退出、会话行双主题、暗色弹窗动作、资料菜单定位、视频确认方式完全一致，新增失败 0；
  - `quick_validate.py`、`pnpm run typecheck`、相关主进程 `node --check`、`pnpm run build` 和 `git diff --check` 均通过；生产构建 89 modules，仅保留既有大 chunk 提示，差异检查仅有 LF/CRLF 工作树提示。
- 主题结论：新增谐波卡片图标同时定义亮色与暗色语义变量，卡片 default、hover、active、focus-visible、disabled 等状态继续复用既有统一交互规则；自动主题契约通过，没有新增孤立的硬编码浅色控件。
- 外部烟测：新增 `scripts/harmonic-live-smoke.mjs`，只读取 Binance 已收盘 1H K 线并输出候选摘要；当前执行环境连接 `fapi.binance.com` 超时，未伪造成功结果。真实行情人工复核、Windows 100%/125%/150% 视觉、安装包/ASAR 和商用授权审查继续保留为发布门禁，不影响代码链路完成结论。
- 法务风险：HarmonicTrader 官方页面对多种名称标注商标并提出商业授权要求；公开策略广场或商业发行前必须由产品/法务确认命名和授权。本实现只保存数学规则摘要和来源索引，不复制原图、课程或长篇材料。
- Git/工作树：未提交；保留当前工作树中其他既有改动，没有覆盖或回滚用户改动。
- 下一任务：进入 TSK-P7-001 内部验证周期；观察期结束且真实行情、双主题实机、安装包与授权门禁满足后再考虑删除兼容壳或签署发布。

### LOG-20260814-018：启动 M1-140 谐波 v2 独立子引擎扩展

- 日期：2026-08-14。
- 状态变化：M1-140 `未开始 → 进行中`；P7 状态不变。
- 目标与范围：在不改写经典五形态规则的前提下，把 Shark 与 Cypher 分别接入独立确定性子引擎，由统一聚合层输出候选；报告、绘图和执行方案必须识别各自拓扑与终点语义。
- 规则冻结：Shark 使用 `0-X-A-B-C`、AB/XA 1.13–1.618、BC/AB 1.618–2.24、C/OX 0.886 或 1.13；Cypher 使用 `X-A-B-C-D`、B/XA 0.382–0.618、C/XA 1.272–1.414、D/XC 0.786。精确完成比率沿用明示的 ±3% 实现容差。
- 来源边界：Shark 以 Scott Carney/HarmonicTrader 原始资料为主；Cypher 公开归因 Darren Oglesbee，但未找到作者控制的原始规则页，因此将一致公开约定单独冻结、单独版本化，避免影响经典与 Shark 引擎。
- 不在范围：5-0、独立 AB=CD、Three Drives、alternate/anti 变体未冒充为已支持形态。
- 回滚：删除 Shark/Cypher 子引擎导入并将聚合入口恢复为经典结果即可；经典子引擎规则版本未变，无用户数据迁移。

### LOG-20260814-019：完成 M1-140 谐波 v2 独立子引擎扩展

- 日期：2026-08-14。
- 状态变化：M1-140 `进行中 → 已完成`；P7 状态不变。
- 实际交付：新增共享子引擎工具、Shark 子引擎、Cypher 子引擎；主引擎升级为 `2.0.0` 聚合器并公开三子引擎状态。经典五形态规则表与子引擎版本保持 `1.0.0`。
- 行为结果：Shark 输出 `0-X-A-B-C`、C Terminal Bar、OX/BC PRZ 和 C→B 主动管理目标；Cypher 输出 `X-A-B-C-D`、D Terminal Bar、XC PRZ、X 外结构失效和 D→C 目标；经典形态继续输出原 XABCD、XA/BC/AB=CD PRZ 和 D→A 目标。
- 报告与绘图：模型只能复核三个子引擎给出的候选 ID；报告按候选输出实际拓扑、比例项、PRZ 组件和目标依据；绘图对 Shark 使用 `0xabc` 路径 ID 与 C 终点标注，对经典/Cypher 使用 `xabcd`，全部仍受 `ai/strategy/harmonic` 图层和语义颜色白名单约束。
- Skill 影响：按 skill-creator 规范将 `SKILL.md` 更新为短入口，把三类冻结规则、来源层级、产品目标政策和未支持边界下沉到 `references/rules.md`；Manifest/绘图政策升级为 v2。
- 自动验收证据：
  - 谐波专项 11/11 通过，覆盖七形态多空镜像、旧五形态表不变、Shark/Cypher 边界值、三子引擎交叉误判、Terminal Bar、拓扑专属绘图、报告、双目标执行方案和 Registry/Coordinator 链路；
  - 原四策略、谐波、运行时、旧链路、生命周期、绘图、持久化、布局、Skill 卡和亮暗主题组合回归 188/188 通过；
  - 串行全仓 2091 项中 2086 通过、5 个失败；失败名称与 BASE-003 完全一致，新增失败 0。并行全仓曾因已有媒体并发测试争用卡住，清理已核实的旧测试链后该用例单独复跑 1/1 通过；最终计数采用无跨文件争用的 `--test-concurrency=1` 结果；
  - `quick_validate.py`、TypeScript、六个谐波主进程文件 `node --check`、Vite 生产构建和差异检查通过；构建 89 modules，仅既有大 chunk 提示。
- 新旧行为等价：经典五种形态的多空镜像、确认、绘图和执行计划专项回归全部通过；原四个交易策略组合回归通过。新增子引擎不进入经典规则循环，不会改变经典形态的硬比例。
- 亮色/暗色结论：本任务没有新增或修改 UI、CSS、颜色、控件或交互状态；策略卡和 Drawing Gateway 继续复用已经验收的双主题语义 Token，相关主题回归通过。
- 风险与限制：Cypher 缺少已找到的作者原始规格页，当前约定必须保持独立版本；商用名称仍需法务授权检查。实时 Binance 烟测与 Windows 安装包/多缩放实机验收未在本任务重复执行，沿用 P7 发布门禁，不能据此签署发布。
- 回滚与数据：移除两子引擎聚合即可回到 v1 五形态；无数据库、用户策略、绘图存储或历史会话迁移。
- Git/工作树：未提交；保留并避开用户现有的其他改动。
- 下一任务：若要继续扩充 5-0、独立 AB=CD 或 Three Drives，必须新增独立规则冻结与子引擎，不能改宽现有七形态判定。

### LOG-20260814-020：启动 M1-141 谐波无候选完成态修复

- 日期：2026-08-14。
- 状态变化：M1-141 `未开始 → 进行中`；P7 状态不变。
- 复现结论：确定性谐波引擎正常完成扫描并返回 `insufficient_data`，但管线主动抛出 `TRADING_HARMONIC_INSUFFICIENT_DATA`，通用渲染层因此显示“盘面分析未完成”。根因是业务无候选与技术故障共用异常通道，不是引擎崩溃。
- 修复边界：不放宽七种形态比例、不移动枢轴、不伪造形态或 PRZ；优先修复结果语义、执行方案、观察绘图和默认数据覆盖。
- 回滚点：恢复谐波管线原 `insufficient_data` 异常分支并移除 Manifest `preferredCount` 即可；没有数据库、历史绘图或用户策略数据迁移。

### LOG-20260814-021：完成 M1-141 谐波无候选完成态修复

- 日期：2026-08-14。
- 状态变化：M1-141 `进行中 → 已完成`；P7 状态不变。
- 实际交付：
  - 谐波无候选现在返回成功完成的确定性分析，报告明确说明扫描正常、七种形态均未通过全部硬门槛、当前不交易以及重新分析条件；
  - 无候选不再调用模型，不生成虚假入场/止损/目标/仓位，只在 `ai/strategy/harmonic` 图层绘制紫色观察摆动或说明标签；
  - Coordinator 继续输出标准 `ExecutionPlanV1`，任务状态为 `completed`，行动状态为 `insufficient_data`；
  - Manifest 契约新增通用、可选且幂等的 `preferredCount`；谐波 v2.1.0 主图与分屏默认优先读取 600 根已收盘 K 线，显式用户区间保持最高优先级，其他策略未声明时维持原取数行为；
  - Skill 与冻结规则新增“无候选也是完成态、禁止编造形态”的规范，后续策略生成和升级必须遵守相同边界。
- 验收证据：
  - 谐波与运行时专项 25/25 通过；新增用例验证 `ok: true`、零模型调用、受控观察绘图、Coordinator 完成态和无交易标准方案；
  - 原四策略、谐波、通用分析、生命周期、旧链路和 Skill 卡组合回归 94/94 通过；七种形态既有识别、绘图和 T1/T2 行为未改变；
  - 显式执行全部 276 个 `*.test.mjs`：主体 2018 项中 2013 通过、5 个 BASE-003 既有失败；媒体文件单独 71/71 通过，合计 2089 项中 2084 通过、5 个既有失败，新增失败 0；
  - 首轮全仓中媒体并发用例曾偶发失败并遗留测试句柄；只终止本次测试进程后，该用例单独 1/1、所在文件 71/71 复跑通过，未触碰开发服务或 24 小时预警压测；
  - 分屏优选窗口首次接入后，全仓门禁捕获到旧单参数 `analysisSnapshot` 源码契约不匹配；已通过方法重载和条件调用保留原单参数路径，精确回归 1/1 后最终主体全仓恢复为 2013/2018，新增失败 0；
  - `node --check`、`pnpm run typecheck`、`quick_validate.py`、`pnpm run build` 和 `git diff --check` 通过；生产构建 89 modules，仅保留既有大 chunk 与工作树 LF/CRLF 提示。
- 用户可见结果复核：140 根无摆动 Fixture 实际输出“扫描已经正常完成”“当前动作：不交易”“入场、止损和目标均不生成”，并生成受控紫色观察说明；不再出现“盘面分析未完成”。
- 新旧行为等价：有合格候选时仍走原确定性候选、受限模型复核、精确绘图和双目标执行方案；只有原先被错误抛异常的无候选分支改为成功完成态。
- 亮色/暗色结论：本修复没有新增或修改 UI、CSS、控件或颜色；观察绘图复用已验收的 `strategy-note` 语义 Token 与 Drawing Gateway，相关策略主题组合回归通过。
- 风险与限制：扩大至 600 根提高历史候选覆盖，但不会保证产生形态；无候选仍应如实不交易。真实 Binance 行情、Windows 多缩放视觉和安装包继续属于 P7 发布门禁。
- Git/工作树：未提交；保留并避开用户现有的其他改动。
- 下一任务：按 P7 内部观察周期验证真实行情中的候选质量与性能，不通过硬规则时继续保持“不交易”而不是放宽比例。

### LOG-20260814-022：启动 M1-142 谐波 v3 多尺度发现与发展中形态

- 日期：2026-08-14。
- 状态变化：M1-142 `未开始 → 进行中`；P7 状态不变。
- 用户问题复现：七形态知识和完成比例没有直接错误，但 v2 只扫描单一摆动尺度、连续五点和已经完成的终点，真实行情中的次级摆动会切断主要结构，尚在发展的合法前置结构也全部被归为无候选，导致明显漏检和低反馈率。
- 改造范围：保持七形态完成规则不变；新增受限多尺度发现、次级摆动对过滤、发展中结构与预测 PRZ；完成/发展中/无候选继续严格分层。
- 安全边界：发展中形态不调用模型，不产生 Terminal Bar、触发、止损、目标、仓位、风险收益或概率；不能为了成功率放宽比例、隐藏更极端摆动或伪造终点时间。
- 回滚点：恢复 v2 单尺度 `runClassicPatternSubengine` 与 Shark/Cypher 连续点输入、移除 `developing` 管线分支并将 Manifest/Drawing Policy 降回 v2；无数据迁移。
- 验收要求：噪声漏检、七形态发展中、分支歧义、零执行价位、性能上限、旧七形态等价、组合/全仓/类型/Skill/构建/差异检查均留实际证据。

### LOG-20260814-023：完成 M1-142 谐波 v3 多尺度发现与发展中形态

- 日期：2026-08-14。
- 状态变化：M1-142 `进行中 → 已完成`；P7 状态不变。
- 实际交付：
  - 谐波聚合引擎升级到 `3.0.0`；经典、Shark、Cypher 子引擎扫描版本升级到 `1.1.0`，七形态完成比例表保持不变；
  - 新增 fine/standard/structural/macro 四尺度摆动扫描、最多跳过两对被更重要端点支配的次级高低点、每尺度 2,000 序列硬上限，以及按形态 ID + 点位索引跨尺度去重；
  - 新增严格隔离的 `developing` 结果：经典使用 XABC、Shark 使用 0-X-A-B、Cypher 使用 XABC；只有前置拓扑/比例和许可投影收敛、完成腿已经启动且未明显越区时才输出；
  - 发展中报告明确显示预测 PRZ、路径进度、可能的形态分支、完成条件和取消条件；绘图只画已确认部分拓扑与“预测 PRZ（未完成）”，不伪造终点时间；
  - 发展中链路模型调用为 0，不生成 Terminal Bar、触发、止损、目标、仓位、风险收益或概率；标准 `ExecutionPlanV1.action` 为 `wait` 且场景为空；严格完成候选继续走原模型受限复核、完整绘图和双目标方案；
  - Manifest 升级到 `2.2.0`、Drawing Policy 升级到 `harmonic-v3`；Skill 和冻结规则按 skill-creator 规范记录完成/发展中/无候选三层边界。
- 准确性与防误报证据：
  - 七种完成形态的多空镜像、比例、PRZ、Terminal Bar 确认、绘图和执行计划全部回归；
  - 插入一对次级噪声高低点的 Gartley 能恢复主要 XABCD；把被跳过高点改得高于目标 C 后，该路径不再允许跳过，证明扫描不会隐藏更极端端点；
  - 七种拓扑在终点未完成样本中均进入发展中候选集合；Crab/Gartley 等共享 XABC 时报告分支歧义，不在 D 形成前强行定型；
  - 近似但不满足完成比例的路径仍不能升级为完成候选，完成比例容差未放宽。
- 测试与性能证据：
  - 谐波专项最终 17/17 通过；新增覆盖多尺度噪声恢复、极端端点拒绝、七形态发展中、预测绘图、零模型/零执行价位、Coordinator 与性能边界；
  - 原四策略、谐波、运行时、Drawing Gateway、生命周期、持久化、布局和双主题组合回归 181/181 通过；将发展中标准方案归一为 `wait` 后，核心策略与运行时再回归 72/72 通过；
  - 600 根高摆动 Fixture 四尺度手工 20 次：中位 11.64ms、P95 14.54ms、最大 15.28ms；自动门禁单次 28.10ms，所有尺度序列数均远低于 2,000；
  - 最终串行全仓 dot 回归只有 5 个 `X`，名称与 BASE-003 完全一致：画布退出、会话行主题状态、暗色弹窗动作、资料菜单定位、视频附件确认；新增失败 0；
  - skill-creator `quick_validate.py`、TypeScript、六个相关模块 `node --check`、Vite 生产构建和 `git diff --check` 均通过；构建 89 modules，仅既有大 chunk 与 LF/CRLF 提示。
- Skill 影响：skill-creator 促使本次把扫描工作流和运行边界保持在短 `SKILL.md`，把多尺度上限、发展中拓扑、投影门槛、来源与未支持范围下沉到 `references/rules.md`；用户可见行为因此明确区分“严格完成”“发展中预测”“当前无候选”。
- 用户体验结论：系统不再要求 D/C 终点已经形成才返回有价值内容。满足前置硬条件时会完成分析、画出部分形态与预测 PRZ，并给出明确等待/取消方案；只有完整候选才出现执行价位，成功率提升不会转化为假信号率提升。
- 亮色/暗色结论：本任务未新增 UI/CSS 或硬编码颜色；新增绘图复用已验收的 `strategy-primary`、`strategy-support/resistance`、`strategy-note` 语义 Token，组合双主题与 Drawing Gateway 回归通过。
- 外部验证限制：Binance 实盘烟测在当前环境连接 `fapi.binance.com` 超时，未伪造真实行情结果；真实市场前向统计、Windows 多缩放视觉和安装包仍属于 P7 发布门禁。
- 回滚与数据：恢复 v2 单尺度入口、移除发展中管线、回退 Manifest/Drawing Policy 即可；无数据库、历史绘图或用户策略数据迁移。
- Git/工作树：未提交；保留并避开用户原有其他改动。
- 下一任务：在 P7 内部观察期记录真实市场中“完成/发展中/无候选”的命中率、终点后失效率和误报率；不得用单纯提高命中率作为继续放宽比例的依据。

### LOG-20260815-024：启动 M1-143 专业谐波绘图语法

- 日期：2026-08-15。
- 状态变化：M1-143 `未开始 → 进行中`；P7 状态不变。
- 用户问题复现：当前发展中候选因整体状态为 tentative，确认过的 X-A-B-C 也被统一画成虚线；X/A/B/C/D 使用备注布局产生引线；图中没有 Fibonacci 测量弦和比例数字，识别结果虽可解释但视觉上不像专业谐波分析图。
- 改造范围：通用 Drawing Gateway 白名单样式、AI 绘图类型/归一化/持久化、谐波完成与发展中绘图编排、亮暗主题文字描边、Skill/冻结规则/Manifest、专项和组合回归。
- 不修改边界：七形态拓扑、比例、PRZ、Terminal Bar、确认、失效、T1/T2、仓位与 ExecutionPlanV1 均不改；不新增谐波专属 DOM/SVG 渲染旁路。
- 风险控制：只允许 `solid/dashed/dotted`、1–4 线宽、枚举字号、布尔粗体和纯文本锚点；继续拒绝原始颜色、CSS、HTML、任意工具和跨策略图层。
- 回滚点：将 Manifest drawing policy 回退到 `harmonic-v3`，移除新增 appearance 字段和 `text` AI 工具，并恢复 v3 绘图编排；不涉及数据库或用户策略数据迁移。

### LOG-20260815-025：完成 M1-143 专业谐波绘图语法

- 日期：2026-08-15。
- 状态变化：M1-143 `进行中 → 已完成`；P7 状态不变。
- 实际交付：
  - 完成经典 XABCD、Shark 0XABC、Cypher XABCD 的专业绘图语法：多空主拓扑分别使用绿色/红色 3px 实线，点名改为无引线纯文本；
  - 经典使用 X-B、A-C、X-D、B-D 四组点虚测量弦，Shark 使用 X-B、A-C、0-C，Cypher 使用 X-B、X-C、X-D；每组显示三位小数比例，CD/BC 与 CD/AB 在同一 B-D 弦上合并展示；
  - 发展中候选把已确认部分保持为实线，仅预测完成腿使用 2px 虚线并显示 `D?`/`C?`；预测腿终点绑定最新已收盘 K 线时间和 PRZ 中点，只表达价格投影，不冒充终点时间；
  - PRZ 和确认/失效/T1/T2 使用虚线条件层；无候选观察分支保持原 tentative 表达；识别和执行逻辑未修改；
  - Drawing Gateway 通用增加受控 `text`、线型、线宽、字号和粗体字段，主进程校验、渲染归一化、AI 模型转换与本地持久化完整往返；非法线型和超宽线条 fail closed；
  - 纯文本使用 `--trading-market-panel` 描边并水平居中；亮色/暗色继续复用已有 `strategy-support/resistance/note` 语义 Token，无新增单主题硬编码颜色；
  - Harmonic Skill 按 skill-creator 规范补充绘图工作流和冻结语法；Manifest 升至 `2.3.0`，Drawing Policy 升至 `harmonic-v4`。
- 验收与测试证据：
  - 谐波 + Drawing Gateway 专项 58/58 通过，覆盖完成/发展中、实线主腿、点虚测量弦、比例标签、预测腿、Shark/Cypher 拓扑隔离、非法样式和双主题；
  - 原四策略、谐波、通用分析、生命周期、Drawing Gateway、布局、运行时、Skill 与旧链路组合回归 181/181 通过；第一次组合回归捕获旧特征测试仍固定五工具列表，更新为受控 `text` 契约后完整复跑通过；
  - 全仓 2117 项中 2112 通过、5 个 BASE-003 既有失败，名称仍为画布退出、会话行主题状态、暗色弹窗动作、资料菜单定位、视频附件确认；新增失败 0；
  - TypeScript 检查、`node --check`、skill-creator `quick_validate.py`、Vite 生产构建和 `git diff --check` 通过；构建 89 modules，仅保留既有大 chunk 警告和工作树 LF/CRLF 提示；
  - 亮暗主题源码回归确认面板描边、看涨/看跌方向色和注释色均存在成对 Token；本轮未自动生成 Windows 多缩放实机截图，该项继续归 P7 安装版视觉门禁。
- 新旧行为等价结论：七种形态的确定性识别、比例门槛、PRZ、确认、状态与 ExecutionPlanV1 不变；只升级受控绘图表达。缠论、订单流、波浪、威科夫和价格行为仍使用原工具、图层和默认渲染回退。
- Skill 影响：skill-creator 使“确认事实用实线、比例测量用点虚线、预测/条件用虚线”的语义进入短工作流，并把各拓扑弦线映射、发展中时间边界和 Drawing Gateway 白名单下沉到冻结规则，避免后续生成 Skill 只模仿外观却破坏证据语义。
- 风险与限制：比例文本采用确定性数据坐标偏移，极端压缩窗口仍可能产生视觉接近；当前有面板色描边和居中缓解，但 Windows 100%/125%/150% 真实行情截图仍需在 P7 做最终视觉签字。
- 回滚与数据：回退 `harmonic-v4` 绘图编排和新增通用 appearance 字段即可；无数据库迁移。旧 AI 绘图记录缺少新字段时继续使用原默认样式，新记录可由旧代码忽略扩展字段。
- Git/工作树：未提交；保留并避开用户现有其他改动。
- 下一任务：在 Haolo 客户端用完成态经典/Shark/Cypher和发展中样本各做亮暗主题、多缩放真实行情截图验收，若出现标签重叠只调整通用布局，不移动确定性点位。

### LOG-20260815-026：启动 M1-144 传统图表形态学完整链路

- 日期：2026-08-15。
- 状态变化：M1-144 `未开始 → 进行中`；P7 状态不变。
- 调研结论：以 Fidelity、StockCharts ChartSchool 和 IFTA 教学框架冻结传统多 K 线形态的先前趋势、触点、几何、收盘突破、假突破、形态高度/旗杆目标和失效规则；不把视觉相似当作确认。
- 实施范围：新建 `chart-patterns` Strategy Skill；拆出反转、延续、双向三个独立子引擎；接入 Registry、统一请求路由、通用行情、专业绘图、标准报告和 ExecutionPlanV1；不改写原五策略引擎。
- 支持范围：首版 17 个可量化核心定义；扩散、钻石、圆弧、Bump-and-Run、岛形、缺口、蜡烛和 V 形等明确留待独立规则，不以“全网最全”为由降低确定性门槛。
- 风险控制：无候选、发展中和假突破均作为成功完成态；双向形态突破前保持中性；模型不拥有点位/价格；Drawing Gateway 和 `strategy-*` Token 继续失败关闭；无下单能力。
- 回滚点：`HAOLO_DISABLED_TRADING_STRATEGIES=chart-patterns` 单策略禁用，或移除新 Manifest/Adapter；无数据迁移。

### LOG-20260815-027：完成 M1-144 传统图表形态学完整链路

- 日期：2026-08-15。
- 状态变化：M1-144 `进行中 → 已完成`；P7 状态不变。
- 实际交付：
  - 按 skill-creator 规范生成并校验 `chart-patterns` Skill、`agents/openai.yaml`、Manifest 和权威规则参考；Manifest 版本 `1.0.0`、Drawing Policy `chart-patterns-v1`、优选窗口 600 根；
  - 新增共享多尺度摆动/ATR/边界/突破/假突破工具，以及反转、延续、双向三个独立子引擎和聚合器；自动发现层覆盖三类形态，17 个 ID 没有跨类别重复；
  - 新增严格请求路由器；裸 mention 走零模型确定性短路由，其他自然语言只提取明确行情参数；conversation 不得改变图表；
  - 完成无候选、发展中、已确认、假突破四条成功业务路径；无候选明确“不是分析失败”，不生成虚假价位；双向发展中同时给出多空条件场景；
  - 完成专业绘图：3px 实线结构、纯文本点名、虚线边界/颈线/触发/失效/T1/T2、收盘突破箭头、受控观察线；全部固定在 `ai/strategy/chart-patterns`；
  - Coordinator 输出标准 `ExecutionPlanV1`，包含方向、触发、确认、失效、两档目标、风险收益、仓位公式、观察、三个周期有效期和取消条件；没有订单或账户写能力；
  - 策略目录、mention 菜单、策略卡和通用 renderer runner 自动发现新策略；新增图表形态卡片图标，同时定义亮色和暗色变量，并补充内部通用策略 Prompt 标签脱敏。
- 正确性证据：
  - 双顶/双底镜像、头肩与三重顶区分、三重顶、上升楔形、对称三角形发展中、矩形向上确认、看涨旗形、杯柄圆底/V 底拒绝和三根假突破取消均通过；
  - OHLC 多尺度发现实际找到已确认头肩顶、发展中对称三角形和已确认看涨旗形；不是只测直接 evaluator；
  - Registry → 确定性裸 mention 路由 → Coordinator → 引擎 → DrawingPatch → StrategyResult → ExecutionPlanV1 端到端通过，头肩顶生成空头条件场景；
  - 专业绘图断言实线结构、点名、虚线 T1、受控策略图层；Drawing Gateway 二次校验通过；
  - 600 根高摆动 Fixture 自动扫描 43–130ms（组合负载差异），低于 500ms 门槛。
- 测试证据：
  - 图表形态专项最终 14/14 通过；策略/谐波/Drawing Gateway/生命周期/布局/持久化组合回归 157/157 通过；
  - 全仓 TAP：2135 项中 2130 通过、5 个 BASE-003 已知失败；失败仍为画布退出、会话行主题状态、暗色弹窗动作、资料菜单定位、视频附件确认，新增失败 0；
  - 八个新主进程模块 `node --check`、TypeScript、skill-creator `quick_validate.py`、生产构建和 `git diff --check` 通过；Vite 91 modules，仅既有大 chunk 警告。
- 亮色/暗色结论：策略图层复用已验收的 `strategy-primary/support/resistance/entry/stop/target/note` 双主题 Token；新增策略卡图标分别定义亮色和暗色背景、前景、焦点环，default/hover/focus/active/disabled 继承统一卡片状态；对应主题回归已纳入组合和全仓测试。未进行 Windows 100%/125%/150% 实机截图，该项继续属于 P7 发布门禁。
- Skill 影响：skill-creator 要求把短执行工作流放入 `SKILL.md`，把 17 个定义、来源、交叉不变量和明确未支持范围放入 `references/rules.md`；因此后续自然语言生成策略不会把未冻结形态偷偷混入宿主或模型 Prompt。
- 风险与限制：合成 Fixture 验证的是规则可复算与链路正确，不等于真实市场胜率。形态阈值需要 P7 前向样本统计误报率、假突破率、目标命中和不同周期稳定性后再版本化调整，禁止只按“命中更多”放宽。
- 回滚与数据：禁用 `chart-patterns` 或移除新 Adapter/Manifest 即可；原五策略、用户画线、会话、预警、账户和订单数据均未迁移。
- Git/工作树：未提交；保留并避开用户原有其他改动。
- 下一任务：在 Haolo 客户端选择不同币种和周期分别验收反转、延续、双向发展中、确认和假突破的亮暗主题实图，并建立前向质量统计，再进入 P7 安装版签字。

### LOG-20260815-028：完成 M1-145 下降三角形误报与历史信号生命周期修复

- 日期：2026-08-15。
- 状态变化：新增缺陷修复任务 M1-145 并完成验收；M1-144 与 P7 状态不变。
- 问题复现与根因：
  - 截图中的旧高点对回归斜率贡献过大，后两个阻力触点实际回升仍可能被宽松斜率阈值误判为下降阻力；水平支撑与边界残差也没有独立硬门槛。
  - 突破扫描可以跨越任意多根 K 线，把后续无关行情归属于早期结构；一次收盘突破确认后只检查最初三根假突破，未继续检查收回边界、穿越止损、目标完成和信号过期。
  - 聚合器把除 `failed` 外的所有历史候选都当作当前候选，报告、绘图和 ExecutionPlan 又回退到 `primaryCandidate`，造成已经结束的形态仍被画成当前方案。
  - 排查同时发现双底向上突破的缺失边界 `null` 会被数值转换为 0，可能产生过早确认；已按镜像方向修正并在公共突破函数中失败关闭。
- 实际修改：
  - `chart-pattern-bilateral-engine.mjs`：子引擎升级至 1.1.0；下降/上升/对称三角形及矩形增加触点方向、水平边界离散度、ATR 残差、收敛顶点和突破时间窗硬规则。
  - `chart-pattern-common.mjs`：突破扫描增加最大归属窗口；新增统一生命周期解析，覆盖发展中过期、假突破、确认后收回、结构止损、T1、T2 与确认信号过期；缺失边界不再视为价格 0。
  - `chart-pattern-reversal-engine.mjs`、`chart-pattern-continuation-engine.mjs`：全部形态接入相同的当前性门禁；引擎版本升级至 1.1.0。
  - `chart-pattern-engine.mjs`：仅 `active`、`awaiting-breakout`、`awaiting-confirmation` 可进入 `activeCandidates`；其余进入 `historicalCandidates`，引擎版本升级至 1.1.0。
  - `chart-pattern-pipeline.mjs`：报告、绘图、叙述和执行计划只消费 `primaryActiveCandidate`；仅有历史结构时明确说明排除原因，不画旧结构线，不生成入场/止损/目标场景。
  - `trading-expert-chart-pattern-analysis.test.mjs`：新增截图式伪下降三角形、合格当前下降三角形、迟到突破、确认后失效、历史候选不绘制/不执行及双底镜像边界回归。
- 验收标准与结果：
  - [x] R1 旧极值掩盖 R2→R3 回升时不得识别为下降三角形。
  - [x] 合格下降三角形必须具有逐级下降阻力、近水平支撑、可接受拟合残差与合理未来顶点。
  - [x] 只有结构结束后有限窗口内的已收盘突破可归属于该结构。
  - [x] 收回触发边界、穿越止损、达到目标或超过有效期后，不得成为当前候选。
  - [x] 仅有历史候选时不绘制旧形态，不输出方向性价格，不生成 ExecutionPlan 交易场景。
  - [x] 原反转、延续、双向形态及 Registry→Coordinator→DrawingPatch→ExecutionPlan 链路保持通过。
- 测试证据：
  - 专项：`node --test test/trading-expert-chart-pattern-analysis.test.mjs`，18/18 通过。
  - 组合：图表形态、谐波、Strategy Runtime/Skill/Legacy、分析生命周期、Drawing、Transcript、Layout 共 9 个文件，161/161 通过。
  - 全仓：首次并发收集运行出现 1 个未复现的额外瞬时失败；随后两次独立完整复核结果一致，均为 2139 项中 2134 通过、5 个失败。失败集合严格等于 BASE-003：画布退出、会话行主题状态、暗色弹窗动作、资料菜单定位、视频附件确认；本次新增稳定失败 0。
  - 工程门禁：7 个相关模块/测试 `node --check` 通过；`pnpm run typecheck` 通过；`pnpm run build` 通过，91 modules，仅既有大 chunk 警告；`git diff --check` 与新增文件尾随空白检查通过，仅既有 LF/CRLF 提示。
- UI/主题结论：本次未修改 Renderer 或 CSS；当前/历史候选的差异通过既有受控 DrawingPatch 语义表达，浅色/暗色 Token 与交互状态没有新增分支。
- 风险与限制：严格几何和当前性门禁会降低“随时都画出一个形态”的命中数量，这是有意的精度优先行为；真实行情误报率、漏报率和不同周期稳定性仍需 P7 前向样本统计及客户端人工烟测。
- 回滚方式：可仅回退上述 6 个图表形态模块和专项测试的 1.1.0/生命周期增量；也可用 `HAOLO_DISABLED_TRADING_STRATEGIES=chart-patterns` 禁用该策略。无数据库、账户、订单或用户绘图迁移。
- Git/工作树：未提交；保留当前工作树中其他既有改动，没有覆盖或回滚用户改动。
- 下一任务：用 BTC/ETH 的 15 分钟、1 小时、4 小时真实前向窗口建立下降三角形和其他三角形的误报/漏报样本集，再决定是否按统计证据微调阈值。

### LOG-20260815-029：启动 M1-165 裸K分析完整链路

- 日期：2026-08-15。
- 状态变化：M1-165 `未开始 → 进行中`；P7 状态不变。
- 调研基线：依据 CME Group 的 OHLC/蜡烛压力、支撑阻力和趋势教材，Fidelity Trading Strategy Desk 的趋势、关键区域、角色互换与加密资产趋势定义，以及 CMT Association 关于蜡烛必须区分趋势位置、确认/未确认和完整/不完整形态的教学框架冻结规则。
- 第一性边界：策略只读取时间与 OHLC；不读取或计算 MACD、RSI、均线、成交量信号，也不把 OHLC 推断包装成真实资金流。实体、影线和收盘位置只表达该周期的买卖压力推断。
- 实施范围：新建 `price-action` Strategy Skill、Manifest、规则参考、请求路由、独立确定性引擎、报告、受控绘图、Registry Adapter 和 `ExecutionPlanV1`；策略目录和菜单继续自动发现。
- 首版场景：趋势回调、突破回踩、区间边缘拒绝、假突破/流动性扫掠后收回、Inside Bar 压缩突破；信号必须同时满足当前市场结构、关键区域、已收盘 K 线和有效期。
- 防误报规则：脱离结构位置的锤子/流星/吞没/内包/外包只记录蜡烛事实，不生成方向交易；历史完成、失效或过期场景不得绘制成当前机会；无候选必须成功返回不交易分析，不得报“分析失败”。
- 绘图边界：只通过 `ai/strategy/price-action` 与 Drawing Gateway，绘制摆动结构、支撑/阻力区域边界、信号 K 线、触发/失效/T1/T2；不增加 Renderer 绘图旁路或下单能力。
- 验收门禁：多空镜像、趋势/区间、上下影线、吞没、Inside/Outside Bar、突破回踩、假突破、历史生命周期、无候选、Registry→Coordinator→DrawingPatch→ExecutionPlan、性能、Skill 校验、双主题、TypeScript、生产构建和全仓基线全部通过。
- 回滚点：设置 `HAOLO_DISABLED_TRADING_STRATEGIES=price-action`，或移除新 Manifest/Adapter；不修改旧通用价格行为管线，不迁移账户、订单、会话或用户绘图数据。

### LOG-20260815-030：完成 M1-165 裸K分析完整链路

- 日期：2026-08-15。
- 状态变化：M1-165 `进行中 → 已完成`；P7 状态不变。
- 知识与边界：将“裸K”定义为只使用时间与 OHLC 的输入边界，将 Price Action 定义为市场结构、关键区域、K线压力、触发确认和风险计划的解释工作流；规则依据 CME、Fidelity、CMT 教学框架和可由 OHLC 复算的 Brooks 术语冻结。成交量、均线、MACD、RSI、订单簿、逐笔、OI 和资金费率均不参与结果；OHLC 只推断价格压力，不声称真实资金流。
- 实际交付：
  - 新增 `price-action` Skill、Manifest、`agents/openai.yaml` 与冻结规则参考，支持“裸K分析”“裸K”“价格行为学”“价格行为”“Price Action”别名并由目录自动发现；
  - 新增独立结构子引擎：三种摆动尺度、HH/HL、LH/LL、EQ、趋势/区间/过渡、已收盘结构突破、重复触点关键区域及支撑阻力角色；
  - 新增独立信号子引擎：实体、上下影线、收盘位置、Doji、拒绝、强势 K、吞没、Inside/Outside Bar；只有结构、位置与已收盘信号同时成立才生成趋势回调、区间拒绝、突破回踩、假突破收回或 Inside Bar 条件场景；
  - 增加 developing、confirmed、partial-target-reached、completed、invalidated、expired 生命周期；完成、失效和过期候选只进入历史集合，不得绘制或进入当前执行计划；
  - 调整主候选排序为证据质量、当前性、场景类别与生命周期的组合权重，当前强假突破/回收不会被较早的弱 Inside Bar 抢占主结论；
  - 新增严格请求路由与 `price-action` Adapter；裸 mention 走零模型确定性链路，conversation 不得修改画布，模型不能创造点位、区域、价位或图形；
  - 新增专业受控绘图：摆动结构实线、HH/HL/LH/LL/EQ 点名、支撑阻力区域虚线框、信号箭头与说明、触发/止损/T1/T2 条件线，全部隔离在 `ai/strategy/price-action` 并经 Drawing Gateway 二次校验；
  - 输出标准 `ExecutionPlanV1`：只使用引擎价位，包含当前动作、方向、触发、确认、结构止损、两档目标、仓位公式、风险收益、观察、取消条件和四根已收盘 K 线有效期；裸K观察文案不再引用成交量，不具备下单或账户写权限；
  - 策略库新增裸K卡片和独立图标；亮色、暗色图标变量成对提供，default/hover/focus/active/disabled 继续继承统一卡片交互状态。
- 验收标准与结果：
  - [x] 市场结构能够识别 HH/HL，并在价格镜像后得到 LH/LL。
  - [x] 假突破必须发生在至少两个触点形成的合格区域，并通过多空镜像测试。
  - [x] 脱离合格区域的 Pin Bar/拒绝 K 只作为事实，不生成方向交易。
  - [x] Inside Bar 在已收盘突破前保持双向条件，不提前猜方向。
  - [x] 任意修改 volume 不得改变结构、K线事实、触发、止损或目标。
  - [x] 过期历史场景不绘制、不生成方向价格和交易场景；无当前候选是成功的等待分析。
  - [x] Registry → 路由 → Coordinator → Engine → DrawingPatch → StrategyResult → ExecutionPlanV1 全链路通过，且不调用复核模型。
  - [x] 600 根 OHLC 扫描在自动门禁内保持有界；专项样本约 9–22ms，低于 500ms 门槛。
- 测试与工程证据：
  - 裸K专项 `test/trading-expert-price-action-analysis.test.mjs`：11/11 通过；覆盖别名、结构镜像、合格区域、误报拒绝、Inside Bar、volume 不变性、专业绘图、历史生命周期、Coordinator、严格路由和性能；
  - 21 个交易专家与策略运行时测试文件：286/286 通过；原缠论、订单流、波浪、威科夫、谐波、图表形态、画图协议、生命周期、策略目录和双主题均未回归；
  - 全仓 TAP：2151 项中 2146 通过、5 个失败；失败名称与 BASE-003 完全一致，为画布退出、会话行主题状态、暗色弹窗动作、资料菜单定位、视频附件确认，本次新增失败 0；
  - skill-creator `quick_validate.py`、相关模块 `node --check`、TypeScript、Vite 生产构建和 `git diff --check` 通过；构建 93 modules，仅既有大 chunk 警告和 LF/CRLF 提示。
- 新旧行为等价结论：裸K作为新的独立 Adapter/Engine/Skill 接入，没有修改缠论、订单流、波浪、威科夫、谐波和图表形态的确定性规则；286 项交易全域回归证明旧策略入口、报告、绘图、生命周期和执行方案仍按原契约运行。
- Skill 影响：skill-creator 要求把短工作流和安全边界放在 `SKILL.md`，把来源、定义、计算门槛、生命周期、绘图语义和未支持范围下沉到 `references/rules.md`；后续扩展价格行为场景只能通过独立规则和 Fixture 进入，不能在宿主或模型提示词中临时硬编码。
- 亮色/暗色结论：新增卡片图标显式定义成对浅色/暗色背景、前景和焦点环，绘图复用已验收的 `strategy-primary/support/resistance/entry/stop/target/note` 双主题 Token；主题与交互源码回归通过。Windows 100%/125%/150% 真实客户端截图尚未执行，保留为 P7 发布门禁。
- 风险与限制：合成 Fixture 证明规则可复算、镜像一致和链路安全，不等于真实市场胜率；严格区域与已收盘确认会有意返回“无交易”，真实行情中的误报、漏报、失效和目标命中需要前向统计后再版本化阈值，禁止只为提高命中次数放宽规则。
- 回滚与数据：设置 `HAOLO_DISABLED_TRADING_STRATEGIES=price-action` 可单策略禁用；或移除新 Manifest/Adapter/引擎/Skill 并回退通用执行计划中的 price-action 专属四周期与 OHLC 观察文案。没有数据库、账户、订单、会话或用户绘图迁移。
- Git/工作树：未提交；保留并避开用户工作树中其他既有改动。
- 下一任务：进入 P7，按 BTC/ETH 的 15 分钟、1 小时、4 小时前向窗口分别记录结构分类、候选类型、触发、失效、T1/T2、无候选和人工复核结果，并完成 Windows 亮暗主题、多缩放真实画线验收。

### LOG-20260815-031：启动 M1-166 裸K蜡烛形态子引擎与圈选标注

- 日期：2026-08-15。
- 状态变化：M1-166 `未开始 → 进行中`；P7 状态不变。
- 用户问题：现有裸K链路只输出通用实体、影线、吞没与 Inside/Outside Bar 事实，没有系统识别顶/底分型、三白兵/三乌鸦、孕线、乌云盖顶、晨星等蜡烛形态，也没有像参考图一样圈选形态 K 线并标注名称。
- 调研基线：CMT Level II 要求区分单根/多根、前置趋势、支撑阻力位置、未确认/已确认与完整/不完整形态；TA-Lib 官方 Pattern Recognition 目录用作名称覆盖审计；StockCharts Candlestick Dictionary 用作可视结构交叉核对。名称存在不等于形成交易信号。
- 实施范围：新增独立 `price-action-candlestick-pattern` 子引擎；冻结单根、双根、三根和多根可复算目录；报告展示最近明确形态；Drawing Gateway 通用增加受控 `circle`，用语义颜色圈住形态完整 K 线范围并以纯文本标注名称；满足趋势、位置和确认的形态才可增强交易场景。
- 防误报原则：K线大小使用本地中位真实波幅归一化；反转形态必须验证前置方向；孕线/吞没使用实体边界；晨星/黄昏星和缺口型形态不得在加密市场无真实跳空时强行成立；重叠形态按完整度、上下文、方向与跨度确定主名称，限制最近圈选数量防止画面污染。
- 绘图与安全边界：圆圈只接受两个证据点、受控线型/宽度与 `strategy-*` Token，固定在 `ai/strategy/price-action`；不允许原始颜色、CSS、任意 SVG、跨策略图层或模型生成点位。
- 验收门禁：用户点名形态、看涨看跌镜像、趋势上下文拒绝、缺口门禁、重叠去重、圆圈范围与名称、Drawing Gateway 非法输入、volume 不变性、生命周期、600 根性能、旧策略、双主题、Skill、类型、构建和全仓基线。
- 回滚点：禁用 `price-action`，或移除蜡烛子引擎并从聚合/绘图/报告撤出；`circle` 为通用向后兼容白名单扩展，可独立回退；无数据迁移。

### LOG-20260815-032：完成 M1-166 裸K蜡烛形态子引擎与圈选标注

- 日期：2026-08-15。
- 状态变化：M1-166 `进行中 → 已完成`；P7 状态不变。
- 目标与实际范围：新增独立确定性 `price-action-candlestick-pattern` 子引擎，冻结 54 项单根/结构、双根、三根和多根形态；用户点名的顶分型、底分型、三白兵、三乌鸦、看涨孕线、乌云盖顶和晨星均进入目录与测试。报告新增“明确K线形态”，最近完整形态按方向使用语义色椭圆包围其完整时间/高低范围并在上方标名，最多四个且重叠去重。
- 知识与误报边界：依据 CMT 的上下文/确认原则、TA-Lib Pattern Recognition 目录和 StockCharts 蜡烛词典冻结规则；反转形态验证前置趋势，位置只取确定性结构区，方向确认只接受后续已收盘 K 线；弃婴、反冲等缺口形态必须存在真实价格缺口，连续加密行情不放宽定义。完整形态可展示，但只有趋势、位置和确认均满足时才可增强执行候选。
- 修改文件：新增 `src/main/trading-analysis/price-action-candlestick-pattern-engine.mjs`、`test/trading-expert-price-action-candlestick.test.mjs` 和 `resources/trading-strategies/builtins/price-action/references/candlestick-patterns.md`；更新裸K策略聚合、信号、报告/绘图管线、受控绘图协议、Renderer 两点校验、Skill/Manifest/规则/`agents/openai.yaml` 及两份计划台账。
- 兼容性更正：LOG-20260815-031 写作“Drawing Gateway 通用增加 circle”。实际实现经旧策略特征回归后收敛为：旧 `ALLOWED_DRAWING_TOOLS` 完全不变，仅声明式/官方 Skill 的 `STRATEGY_ALLOWED_DRAWING_TOOLS` 增加 `circle/ellipse`；裸K实际使用两角点定义的 `ellipse`，比中心+半径圆能准确包围多根 K 线。缠论、订单流、波浪和威科夫权限边界没有扩大。
- 验收项及证据：
  - [x] 54 项目录和用户点名形态存在；晨星/黄昏星、三白兵/三乌鸦、孕线、乌云盖顶/刺透、顶/底分型通过多空镜像。
  - [x] 错误前置趋势被拒绝；真实缺口成立、相接 K 线不成立；volume 改变不影响形态事实、价位或绘图几何。
  - [x] 椭圆和标签共用形态与逐根 K 线证据 ID；圆/椭圆非两点输入由主进程协议拒绝；固定 `ai/strategy/price-action` 图层、`strategy-*` Token 和绘图数量上限。
  - [x] 形态可见性与可执行性分离；没有位置或收盘确认时报告明确“不单独构成交易”，不自动下单。
- 测试证据：裸K专项 20/20；全部交易相关 446/446；Skill `quick_validate.py` 通过；TypeScript 检查通过；Vite production build 通过并转换 93 modules；全仓 2160 项中 2155 通过、5 项失败，失败严格等于改造前 BASE-003（画布退出、会话行双主题状态、暗色弹窗操作、资料菜单、视频附件确认），本次新增失败 0。
- 亮色/暗色与交互状态：本任务没有新增 CSS 或硬编码颜色；椭圆、文字及状态继续使用现有 `strategy-support/resistance/note` 语义 Token，Renderer 原生 SVG 椭圆在亮暗主题共享同一绘制和交互链路；相关主题/绘图回归包含在 446/446。Windows 100%/125%/150% 实机视觉尚未执行，保留为 P7 发布门禁。
- 性能与安全：600 根 OHLC 扫描继续通过 250ms 门禁；无模型生成点位、无任意颜色/SVG/CSS、无 volume/指标/订单/凭据能力，旧策略全局绘图白名单未改变。
- 已知风险：蜡烛名称本身不是收益信号；小流动性市场、极端波动和品种交易时段差异仍可能产生统计噪声。真实行情命中率、标签碰撞和多缩放视觉只能在 P7 前向窗口确认；少数定义分歧较大的罕见形态明确列入参考文档的暂不支持清单，不伪称“全世界所有命名法”。
- 回滚方式：设置 `HAOLO_DISABLED_TRADING_STRATEGIES=price-action` 单策略禁用；或撤出子引擎在策略聚合、信号、报告/绘图中的接线并回退 `price-action-v2` 及策略专属圆/椭圆白名单。无数据库、账户、订单、会话或用户手工绘图迁移。
- Git/工作树：未提交；保留并避开用户工作树中其他既有改动。
- 下一任务：进入 P7，在 BTC/ETH 的 15 分钟、1 小时、4 小时真实前向窗口记录形态名称、趋势上下文、关键区、确认、可执行性和失效结果，并完成 Windows 亮暗主题、多缩放及安装版验收。

### LOG-20260815-033：完成 M1-167 裸K客户端入口统一接线修复

- 日期：2026-08-15。
- 状态变化：M1-167 `未开始 → 已完成`；P7 状态不变。
- 用户证据：开发版截图中的 `@策略:裸K分析` 仍显示“模型复核补充”、EMA20/EMA50、量能比和旧价格结构图，没有“明确K线形态”章节或椭圆标注；这与 M1-166 的 OHLC-only 输出契约直接矛盾。
- 根因：`TradingMarketWorkspace.runGeneralConversation` 把缺省普通盘面分析和显式 `price-action` 策略共用同一个默认值，并保留 `strategyId === "price-action" ? runTradingGeneralAnalysis : runTradingStrategyAnalysis` 历史特判。客户端因此绕过 `price-action-adapter`、独立蜡烛子引擎和标准执行计划；此前 Registry/Coordinator 单元测试通过但没有锁定 Renderer 的实际 API 选择。
- 修复：把“未传 strategyId”定义为普通通用盘面问答，继续调用原 `runTradingGeneralAnalysis`；任何显式策略 ID（包括 `price-action`）统一调用 `runTradingStrategyAnalysis` 并携带该 ID。任务/绘图上下文使用 `analysisTheory = strategyId || "price-action"`，保持普通历史图层兼容。新增反回退断言，明确禁止再次出现 price-action 到旧通用 API 的特判。
- 兼容边界：未删除旧通用价格结构问答，未修改其他策略 Adapter、主进程 Coordinator、行情获取、用户手工绘图或主题样式；只有显式 `@策略:裸K分析` 的客户端执行入口切到其声明的新版 Skill。
- 验收证据：裸K、K线形态、通用盘面与绘图定向 73/73；全部交易测试 446/446；TypeScript 通过；Vite production build 通过并转换 93 modules；全仓 2160 项中 2155 通过、5 项严格等于 BASE-003，本次新增失败 0。
- 开发版：旧开发端口已停止且没有活跃开发 Electron；修复后重新启动 `scripts/dev.mjs`，Vite `http://127.0.0.1:5177` 与 Electron 主进程均已就绪。Chrome Native Host 缺失和 Windows 快捷方式修复告警为既有非交易分析告警，不阻断裸K链路。
- 预期可见结果：再次发送 `@策略:裸K分析 分析下` 时，报告必须出现“明确K线形态”；有满足完整定义的最近形态时绘制实线椭圆和中文名称，没有满足门槛时该章节明确报告未命中，而不能回退显示 EMA 或量能比。
- 回滚：恢复该 Renderer API 选择函数即可回到旧行为；无数据迁移。常规策略级回滚仍可使用 `HAOLO_DISABLED_TRADING_STRATEGIES=price-action`。
- Git/工作树：未提交；保留并避开用户工作树中其他既有改动。
- 下一任务：由用户在已重启开发版复测同一 BTC/USDT 日线；随后进入 P7 真实前向和多缩放视觉验收。

### LOG-20260815-034：完成 M1-168 裸K椭圆跨进程落图修复

- 日期：2026-08-15。
- 状态变化：M1-168 `未开始 → 已完成`；P7 状态不变。
- 用户证据：新版裸K策略已经进入确定性分析，但在播放 Drawing Patch 时提示 `AI drawing operation 11 is invalid`，没有完成报告与图表提交。
- 根因：主进程 `STRATEGY_ALLOWED_DRAWING_TOOLS` 已允许并验证 `circle/ellipse`，Renderer 也已有圆/椭圆的点数校验与 SVG 渲染能力，但 `TRADING_AI_DRAWING_TOOLS` 仍停留在旧集合。第 11 项是第一个形态椭圆，因工具白名单不一致在 Renderer 标准化阶段被拒绝。
- 修复：只在 Renderer 受控 AI 工具集合补入 `circle` 与 `ellipse`；主进程普通旧策略白名单保持不变，策略图层、语义颜色、两点数量、市场身份和最多 64 项限制继续生效。持久化读取与播放共用同一集合，因此新形态可正常恢复和重放。
- 新增门禁：晨星 Fixture 生成真实 `price-action` Drawing Patch 后，先通过 `validateStrategyDrawingPatch`，再传入 `normalizeTradingAiDrawingPatch`；断言椭圆与“晨星”文字均存在。该测试能直接捕获本次主进程通过、Renderer 拒绝的协议漂移。
- 验收证据：裸K、Renderer、通用策略网关和绘图定向 75/75；全部交易测试 446/446；TypeScript 通过；Vite production build 通过并转换 93 modules；全仓 2160 项中 2155 通过、5 项严格等于 BASE-003，本次新增失败 0。
- 开发版：源码观察器检测到 Renderer 变化并完成 Electron 热重启；Vite 5177 与开发主进程继续运行。无需重启机器或重新安装客户端。
- 亮暗主题：未新增 CSS 或硬编码颜色；圆/椭圆继续使用 `strategy-support/resistance/note` 主题 Token，既有 SVG 渲染在亮暗主题共享同一路径。
- 回滚：从 Renderer 受控集合撤出 `circle/ellipse` 即可，但会再次禁用策略形态圈选；无数据迁移。
- Git/工作树：未提交；保留并避开用户工作树中其他既有改动。
- 下一任务：由用户在当前已重启开发版重试同一裸K请求，确认报告出现“明确K线形态”且有命中时椭圆与标签均成功落图；之后进入 P7。

### LOG-20260815-035：完成 M1-169 裸K形态标签双主题与碰撞避让

- 日期：2026-08-15。
- 状态变化：M1-169 `未开始 → 已完成`；P7 状态不变。
- 用户证据：开发版实图中相邻 K 线上同时命中的“纺锤线”等名称出现文字相互覆盖，并压到 K 线和形态图元；原标签还使用加粗及白色描边。用户最终确认浅色使用紫色、暗色使用白色，且要求文字之间及与其他元素之间不得重叠。
- 修复：K线形态标签单独增加语义主题变量，浅色为与策略注释一致的 `#6d4acb`，暗色为 `#ffffff`；强制 `font-weight: 400`、`stroke: none`、`paint-order: normal`，其他谐波、结构和普通 AI 标签继续保留原可读性描边，不被全局改动。
- 碰撞布局：Renderer 在每次重绘时按实际屏幕像素计算短标签尺寸，优先布局蜡烛形态名称，再布局普通 AI 注释；统一保留 12px 标签间距和 8px 图元留白，并避开可见 K 线实体/影线、对应形态椭圆、其他结构文字、价格行为路径、信号箭头及矩形区间边界。缩放、拖动、切周期和窗口尺寸变化会自然触发重新布局，不把像素偏移写回策略证据或持久化数据。
- 安全与兼容：碰撞识别严格限定 `source=ai + strategyId=price-action + candlestick-pattern-label`；原策略输出点、证据 ID、形态识别、执行方案、用户手工绘图、其他策略绘图和 Drawing Gateway 均未修改。无法计算布局时普通文字仍以原锚点渲染，只有原本就要求布局的 AI note 维持旧的失败关闭行为。
- 验收证据：新增三枚相邻标签在密集 K 线和策略图元中的确定性布局 Fixture，逐一断言与 K 线、图元及彼此均不相交；同时锁定作用域识别、标签优先级、180px 水平关联范围、主题变量、常规字重和无描边。定向 62/62、全部交易测试 447/447、TypeScript 检查通过、Vite production build 通过并转换 93 modules；全仓 2157 项中 2152 通过，5 项失败严格等于 BASE-003，本次新增失败 0。
- 亮色/暗色与交互状态：亮色紫字、暗色白字均无描边且不加粗；标签是只读 SVG 图元，不新增 hover、active、focus、open、loading 或 disabled 控件状态。主题测试同时保留其他 AI 标签的亮暗描边契约，防止局部需求扩散为全局退化。
- 开发版：源码观察器已完成 Electron 热重启，Vite 5177 与最新 Electron 主进程继续运行。
- 已知风险：自动布局优先保证可读性，因此极端密集图表中的标签可能离原形态稍远，但水平关联距离受 180px 限制；Windows 100%/125%/150% 人工视觉验收仍属于 P7 发布门禁。
- 回滚：移除 K线形态标签专属主题 class、布局请求和价格行为图元障碍收集即可恢复原锚点渲染；不涉及数据库、订单、会话、策略证据或用户绘图迁移。
- Git/工作树：未提交；保留并避开用户工作树中其他既有改动。
- 下一任务：由用户在当前开发版重新运行同一裸K分析，检查多个同时命中的形态名称是否清晰错层；随后进入 P7 多缩放实机视觉验收。

### LOG-20260815-036：完成 M1-170 裸K形态标签目标指引虚线

- 日期：2026-08-15。
- 状态变化：M1-170 `未开始 → 已完成`；P7 状态不变。
- 用户证据：碰撞避让已使紫色形态名称彼此分离，但移动后的文字缺少与目标 K 线的视觉关联，无法快速判断“纺锤线”“长脚十字”等名称具体对应哪一根或哪一组 K 线。
- 修复：每个裸K蜡烛形态标签从文字布局框的最近边缘绘制同主题色虚线，连接到对应形态椭圆顶部中心，并在目标端绘制 2.2px 圆点。单根形态指向该 K 线，多根形态指向被椭圆圈选的 K 线组中心；标签位置变化后连线随每次重绘同步更新。
- 主题与视觉：指引线与标签共用 `--trading-price-action-candlestick-label`，浅色为紫色 `#6d4acb`、暗色为白色 `#ffffff`；线宽 1.2px、虚线节奏 `4 4`、圆头、非缩放描边和 0.78 透明度，目标点无额外描边。标签仍为常规字重且无白边。
- 定位语义：策略 Drawing Patch 将标签原始锚点收敛到形态椭圆上沿，而不是悬空在其上方；Renderer 只移动显示文字，锚点继续保存确定性的形态时间中心与价格上沿，因此虚线始终指回该形态证据，不根据模型文本猜测目标。
- 安全与兼容：虚线和端点只对 `price-action` 的 `candlestick-pattern-label` 生效；其他策略、结构标签、普通 AI note、用户手工绘图、执行方案和形态检测结果不变。SVG 图元保持只读并不接管指针事件。
- 验收证据：定向 62/62、全部交易测试 447/447、TypeScript 检查通过、Vite production build 通过并转换 93 modules；全仓 2157 项中 2152 通过，5 项失败严格等于 BASE-003，本次新增失败 0。新增断言锁定标签锚点与椭圆上沿同价、时间位于形态区间内部，以及虚线、最近边缘连接点、目标圆点和双主题颜色契约。
- 回滚：移除标签锚点收敛、Leader/Target SVG 与对应样式即可恢复 M1-169 行为；无数据迁移。
- Git/工作树：未提交；保留并避开用户工作树中其他既有改动。
- 下一任务：由用户在开发版复测相邻单根/多根形态，确认每条虚线均能唯一指回对应形态；随后进入 P7 多缩放实机视觉验收。

### LOG-20260815-037：完成 M1-171 底分型及全部多K组合形态椭圆可见性

- 日期：2026-08-15。
- 状态变化：M1-171 `未开始 → 已完成`；P7 状态不变。
- 用户证据：ETH/USDT 1小时开发版已经显示“底分型·已确认”及其目标虚线，但底分型三根 K 线周围没有可辨识的系统椭圆；用户手工绘制红色椭圆后才能明确表达预期范围，并要求排查全部组合 K 线形态。
- 根因审查：主进程 `appendCandlestickPatterns` 已对每个 `drawablePattern` 成对生成椭圆和标签，协议、Renderer 白名单、持久化和 SVG 椭圆分支均存在；缺口在最终可见性。椭圆沿用 bullish/bearish/neutral 多空语义色，在同色K线、支撑/压力区填充和结构图元上容易被淹没，同时没有为蜡烛形态冻结独立的顶层顺序。
- 修复：为 `source=ai + strategyId=price-action + candlestick-pattern ellipse` 增加严格作用域识别；所有裸K形态椭圆统一使用与标签相同的高对比主题色、2.4px 实线、0.96 不透明度和非缩放描边，并以稳定排序放在结构路径、区域和信号图元之上、标签及目标虚线之下。亮色为紫色，暗色使用对应白色主题变量。
- 全目录排查：54 项目录中共有 42 种多K组合形态，包括双根、三根、四根和五根形态。新增逐项 Fixture，为每个目录项单独构造确定性 `drawablePattern` 并走完整 `buildPriceActionStrategyDrawingPatch → validateStrategyDrawingPatch → normalizeTradingAiDrawingPatch`；每项必须存在同证据 ID 的“椭圆+标签”，椭圆时间范围必须越过首尾 K 线中心，价格范围必须覆盖组合最高价和最低价。
- 特定覆盖：顶分型、底分型、吞没、孕线、刺透、乌云盖顶、镊子、晨星/黄昏星、三白兵/三乌鸦、三内/三外、弃婴、夹心底、三线反击及上升/下降三法等全部进入同一门禁，不为底分型增加孤立特判。
- 验收证据：定向 63/63、全部交易测试 448/448、TypeScript 检查通过、Vite production build 通过并转换 93 modules；全仓 2158 项中 2153 通过，5 项失败严格等于 BASE-003，本次新增失败 0。
- 亮色/暗色与交互状态：椭圆的 fill、stroke 和标签统一读取双主题语义变量；图元只读且不新增 hover、active、focus、open、loading 或 disabled 状态。用户手工椭圆仍走原样式和交互链路，不被专属选择器修改。
- 回滚：移除形态椭圆识别、绘制排序、专属 class/CSS 和组合形态目录测试即可恢复 M1-170；不涉及行情、形态识别、数据库、会话、订单或用户绘图迁移。
- 开发版：源码观察器已完成 Electron 热重启，Vite 5177 与最新 Electron 主进程继续运行。
- 下一任务：由用户在当前开发版重新运行同一 ETH/USDT 1小时裸K分析，确认底分型及同屏其他命中形态均出现完整高对比椭圆；随后进入 P7 多缩放实机视觉验收。

### LOG-20260815-038：完成 M1-172 裸K椭圆分数坐标、线宽与组合范围收敛

- 日期：2026-08-15。
- 状态变化：M1-172 `未开始 → 已完成`；P7 状态不变。
- 用户验收规则：椭圆描边由 2.4px 收敛为 0.8px；只有两根及以上的组合 K 线形态绘制椭圆，单根 K 线形态不绘制椭圆，但形态名称及指向目标 K 线的虚线继续保留。
- 最终根因更正：M1-171 解决了主题对比和图层顺序，但真实运行时仍存在几何退化。策略为了完整包围蜡烛，在首尾时间各扩展 0.48 根 K 线；Lightweight Charts 5.1 的 `logicalToCoordinate` 对非整数 logical 返回 `0`，导致两个端点都投影到横坐标零、`rx=0`，SVG 椭圆虽存在但没有可见宽度。Renderer 现改为分别投影 floor/ceil 整数 logical，再做线性插值；真实 DOM 已验证椭圆半径由零恢复为非零。
- 生成端范围：`appendCandlestickPatterns` 以 `endIndex - startIndex + 1` 计算真实 K 线数量；只有 `candleCount >= 2` 才生成 ellipse operation。54 项目录中 42 种双根、三根、四根、五根组合形态继续有椭圆，12 种单根形态只生成 text operation，不改变检测事实、确认状态或报告内容。
- 历史兼容：Renderer 对已持久化的旧 `price-action/candlestick-pattern` 椭圆计算端点 logical 跨度；小于 1.5 根 K 线时识别为旧单根形态并跳过 SVG 输出。因此旧任务无需清理本地数据也不会继续显示单根锤子线、长脚十字等椭圆；双根及以上历史椭圆不受影响。
- 线宽与协议：专属 CSS 和新 Drawing Patch 均使用 0.8px；主进程协议及 Renderer 的受控线宽下限同步从 1 调整为 0.5，0.8 可完整通过校验和持久化，低于 0.5 或高于 4 仍失败关闭。范围变化不扩大工具、颜色、图层、市场或策略权限。
- 亮色/暗色：椭圆继续使用 `--trading-price-action-candlestick-label`，浅色为紫色、暗色为白色；仅描边宽度变为 0.8px。标签、目标虚线、端点、碰撞避让、只读和非缩放描边语义不变；用户手工椭圆及其他策略绘图不套用专属 class。
- 验收证据：定向测试 54/54，全部交易测试 450/450，TypeScript 检查通过，Vite production build 通过并转换 93 modules；开发版源码观察器完成 Electron 重启。全仓测试执行后仍为 BASE-003 的 5 项既有失败，本次相关测试无失败、新增失败 0。
- 回滚：恢复协议/Renderer 线宽下限为 1，移除分数 logical 插值、单根历史椭圆过滤和 `candleCount >= 2` 生成门禁，并将专属描边恢复为 2.4px，即可回到 M1-171；无需数据库、行情、会话、订单或用户绘图迁移。
- Git/工作树：未提交；保留并避开用户工作树中其他既有改动。
- 下一任务：用户在当前开发版复测同一裸K分析；验收点为单根锤子线/十字类只有标签与虚线，底分型、孕线、晨星等双根及以上组合显示 0.8px 完整椭圆。随后进入 P7 多缩放实机视觉验收。

### LOG-20260815-039：完成 M1-173 裸K形态收盘确认语义与执行门禁

- 日期：2026-08-15。
- 状态变化：M1-173 `未开始 → 已完成`；P7 状态不变。
- 用户证据：ETH/USDT 4小时开发版把已收盘锤子线标为“待确认”，同时把右侧最后一根 K 线仍未收盘的顶分型标为“已确认”；用户进一步确认最终显示规则为：已收盘形态只显示名称，只有未收盘 K 线结构显示“待收盘”。
- 根因：形态子引擎原先只维护一个 `confirmation` 字段，同时表达“形态组成 K 线是否收盘”和“形态后是否出现方向跟随”；分型又用 `intrinsicallyConfirmed` 直接确认三根几何，未检查右侧 K 线的收盘边界。Renderer 标签据该混合字段显示文案，最终造成两个方向相反的状态错误。
- 修复：新增按 TradingView 周期和 `snapshotTime` 计算最后已收盘 K 线的确定性边界，兼容秒、分钟、小时、日、周及毫秒/秒快照时间；每个形态独立输出 `formationStatus` 与方向 `confirmation`。形态所含最后一根未收盘时固定为 `forming/complete=false/actionable=false`，未收盘后继 K 线也不得确认方向。
- 执行安全：市场结构和信号子引擎改为只读取已收盘快照；完整输入仍可用于预览正在形成的蜡烛形态。信号匹配额外拒绝 `complete=false/formationStatus=forming`，因此未收盘顶分型、底分型及其他组合形态不能触发结构突破、入场、止损或目标方案。
- 最终显示：已收盘锤子线、顶/底分型及其他 54 项形态只显示形态名称，不再附加冗余“已确认”；只有形态依赖未收盘 K 线时显示“· 待收盘”。未收盘组合形态的椭圆与标签使用既有 tentative 状态，已收盘形态继续使用 confirmed 图元状态；报告分别陈述“形态收盘”和“方向跟随”，不再把两者混写。
- 回归门禁：新增真实 4H 时间边界 Fixture，同时覆盖已收盘锤子线 + 未收盘跟随 K 线、未收盘右侧顶分型、镜像底分型、标签文字、图元状态、报告语义及执行候选不得引用未收盘索引；42 种组合和 12 种单根目录逐项断言已收盘标签只保留名称。
- 验收证据：专项测试 38/38；全部交易测试 451/451；TypeScript 检查通过；Vite production build 通过并转换 93 modules；全仓 2165 项中 2160 通过、5 项失败严格等于 BASE-003，本次新增失败 0。
- 亮色/暗色与交互状态：未新增 CSS、颜色或交互控件；confirmed/tentative 继续走既有双主题语义 Token，浅色紫色、暗色白色、碰撞避让、目标虚线、椭圆线宽和只读行为均不变。
- 风险：周期无法解析时会用相邻 K 线时间差中位数推断；若快照时间和 K 线时间源严重错位，引擎会失败关闭而不是把未收盘数据提升为交易信号。Windows 100%/125%/150% 人工视觉验收仍属于 P7 发布门禁。
- 回滚：移除最后收盘边界、`formationStatus`、已收盘快照切片与信号完整性过滤，并恢复标签读取方向 `confirmation`，即可回到 M1-172；不涉及数据库、订单、会话、用户绘图或行情迁移。
- Git/工作树：未提交；保留并避开用户工作树中其他既有改动。
- 下一任务：用户在当前开发版重新运行同一 ETH/USDT 4小时裸K分析；验收点为已收盘锤子线只显示“锤子线”，未收盘右侧分型显示“顶分型 · 待收盘”，收盘后重新分析只显示“顶分型”。随后进入 P7 多缩放实机视觉验收。

### LOG-20260815-040：完成 M1-174 道氏理论独立趋势环境 Skill 完整链路

- 日期：2026-08-15。
- 状态变化：M1-174 `未开始 → 已完成`；P7 状态不变。
- 目标与实际范围：新增 `dow-theory` 官方策略包、独立 Adapter/Request Router、确定性趋势引擎、报告、受控绘图、标准执行计划及可选高周期数据声明；原七个策略不读取道氏结果、不修改算法、不建立隐式运行依赖。
- 知识冻结：依据 StockCharts ChartSchool、LBMA Alchemist 与 CMT Association 冻结主要趋势、次级运动、小级别波动、趋势持续至明确反转、收盘价确认及成交量辅助原则。经典“平均指数相互确认”在当前单品种快照中固定为 `unavailable`；多周期同向只能标为产品上下文，不能冒充经典确认。OHLCV 不足以可靠判断道氏三阶段，v1 固定为 `indeterminate`，不复用威科夫吸筹/派发标签。
- Skill 影响：按 `skill-creator` 将触发语义、工作流、组合边界和安全边界放入 `SKILL.md`，详细规则放入单层 `references/rules.md`；`agents/openai.yaml` 允许隐式发现，描述明确优先调用道氏的场景，以及应优先波浪、图表形态、谐波或裸K的反例。官方 `quick_validate.py` 在 `PYTHONUTF8=1` 下通过；首次 Windows `cp1252` 读取中文失败属于校验器环境编码，未绕过门禁。
- 引擎与确认：三个独立摆动尺度分别使用 6/4/2 根左右确认半径和 2.20/1.35/0.70 中位 OHLC 波幅最小位移；输出 HH/HL/LH/LL/EH/EL。结构、突破和执行只消费已收盘 K 线；影线越界而收盘未越界固定为 `wick-only-unconfirmed`。成交量只改变辅助状态，不改变价格结构或价位。
- 上下文能力：Manifest 以 `context-candles` 可选数据需求声明高周期能力；Renderer 只有在策略声明该键时才并行获取最多三个高周期，原七策略不会新增网络请求。分屏按各自品种和周期独立获取，失败时降级为空上下文，确定性主周期分析仍可完成。
- 绘图与执行：主要趋势使用 2.5px 实线、次级运动使用 1.2px 点线，确认摆动标注 HH/HL/LH/LL；触发、失效和 1R/2R 目标使用语义虚线，全部固定在 `ai/strategy/dow-theory`。Coordinator 从引擎价位生成非下单的 `ExecutionPlanV1`；无明确趋势时成功返回等待且不编造价格。
- 模型调用边界：裸 `@策略:道氏理论` 走确定性短动作，不调用路由模型；复杂自然语言由严格 JSON Router 分类。Skill/Manifest 已让目录和模型上下文能够按趋势环境语义选择该能力，但本任务没有把无 `@策略` 的普通聊天强制改造成自动策略选择，避免改变现有会话路由。
- UI 主题：策略广场新增道氏图标，浅色使用紫灰底/深紫线，暗色使用深紫透明底/浅紫线；复用卡片既有 default、hover、active、focus 与 disabled 状态。源码回归同时断言亮暗主题专属 Token；未新增菜单、对话框、表单或加载控件。
- 测试证据：道氏专项 7/7，覆盖多空镜像、未收盘突破隔离、收盘确认、高周期冲突、经典确认不可用、成交量不改结构、绘图/执行计划、严格路由及按能力取高周期；全部交易测试 458/458；TypeScript 检查通过；Vite production build 通过并转换 95 modules；全仓共 2172 项，其中 2167 通过、5 项失败严格等于 BASE-003（canvas exit、minimal row hover、dark dialog actions、profile menu、video upload confirm），本次新增失败 0。
- 风险：摆动半径和最小位移是首版确定性参数，跨品种/周期仍需 P7 真实行情前向验证；当前没有经典配对指数数据，因此不能对“市场相互确认”给出已确认结论。多周期 REST 请求只对本策略开启，网络不可用时降级但不阻断主周期。
- 回滚：将 `dow-theory` 加入 `HAOLO_DISABLED_TRADING_STRATEGIES` 可停用单策略；完整回滚可移除新增策略包、Adapter/引擎/Router、目录图标样式和 `contextCandlesRequested` 能力开关，不涉及数据库、账户、订单、会话、用户绘图或原策略迁移。
- Git/工作树：未提交；保留并避开用户工作树中其他既有改动。
- 下一任务：用户在当前开发版用 1H/4H/1D 趋势、回撤和影线假突破样本运行 `@策略:道氏理论`，确认主/次趋势绘图及等待条件；随后进入 P7 Windows 100%/125%/150% 亮暗主题和真实行情前向验证。

### LOG-20260815-041：完成 M1-175 江恩理论独立 Skill 与三子引擎完整链路

- 日期：2026-08-15。
- 状态变化：M1-175 `未开始 → 已完成`；P7 状态不变。
- 目标与实际范围：新增 `gann-theory` 官方策略包、独立 Adapter/Request Router、共享确认锚点与标尺层、江恩角度线、方格/轮中轮、Square of Nine 数字螺旋三个确定性子引擎、受控绘图、解释报告和标准执行计划；原八个策略不读取江恩结果、不修改算法、不建立隐式依赖。
- 知识冻结：依据 TradingView 官方 Gann Fan/Square/Box 工具文档冻结重要转折点锚定、价格/时间对称、九条角度线和正确尺度；依据 CMT Association `Core Framework` 冻结 Square of Nine 的平方根加减因子再平方公式、45° 至 360° 因子表，以及高低价品种移动小数尺度的边界。没有声称“穷尽全网”；只把权威资料中可复算、可测试的部分进入自动化。
- Skill 影响：按 `skill-creator` 建立 `strategy.json + SKILL.md + agents/openai.yaml + references/rules.md` 标准包；触发语义、工作流、组合边界、反例和安全边界写入 Skill，公式、参数、绘图语法和来源写入单层规则文档。`quick_validate.py` 最终在 UTF-8 模式通过；首次缺少 PyYAML、第二次 Windows `cp1252` 读取中文失败均属于校验环境，未绕过门禁。
- 公共锚点与收盘门禁：所有子引擎只消费 `snapshotTime` 前完整结束的 K 线；当前未收盘极值不能替换锚点、改变方向或触发执行。局部确认点不足时使用最近 120 根已收盘 K 线的分段极值降级，从而保证分析成功但显式降低锚点质量。
- 角度线子引擎：1x1 冻结为 `pricePerBar = priceRange / barCount`，与屏幕 45° 无关；九条线固定为 1x8、1x4、1x3、1x2、1x1、2x1、3x1、4x1、8x1，并在同一活动方格边界截断，避免极陡线压坏价格轴。上升/下降镜像使用相同斜率绝对值。
- 方格与轮中轮子引擎：外层方格以同一锚点和标尺覆盖当前活动投影，在价格与时间轴同时画 1/4、1/2、3/4 分割与两条对角线；轮中轮用共享同一标尺的 1/2 和 1/4 嵌套方格表达，不把任意缩放矩形或实体占星轮盘冒充第二套周期。
- 数字螺旋子引擎：自动把锚价移动小数到 `[100,1000)` 后，以 `((sqrt(anchor/priceUnit) ± factor)^2) × priceUnit` 计算上下两侧 45° 至 360° 共 16 个层级；图上只显示距离当前价最近的上三层和下三层，文字包含方向、角度和价格。没有在 K 线上叠加与坐标无关的装饰性螺旋。
- 绘图与执行：九线扇形、外层方格、轮中轮、等分线、对角线、数字螺旋价位、触发/失效/T1/T2 与摘要全部固定在 `ai/strategy/gann-theory`，总操作数低于协议 64 上限。触发取锚点前最近反向结构点外侧，目标优先选择合格 Square of Nine 层级，否则退化为 1R/2R；单独触线、视觉共振和影线均不能确认，`ExecutionPlanV1.action=wait` 且不生成订单数量。
- 模型与反神秘化边界：裸 `@策略:江恩理论` 直接走确定性分析，不调用 Router 模型；复杂自然语言才进入严格 JSON 分类。自动化明确排除占星、行星位置、星盘、不可复算日期神秘数、胜率和必然转折承诺；价位与角度只是等待已收盘价格行为验证的候选条件。
- UI 主题：策略广场新增江恩图标，浅色为暖橙浅底/棕橙线，暗色为棕橙透明底/浅橙线；复用卡片既有 default、hover、active、focus 与 disabled 状态。图表绘制继续使用策略语义 Token，因此亮暗主题随现有 Drawing Gateway 自动切换；未新增菜单、表单、弹窗或加载控件。
- 测试证据：江恩、运行时和 Skill/主题专项 29/29；全部交易相关测试 464/464；全仓 2178 项中 2173 通过、5 项失败严格等于 BASE-003（canvas exit、minimal row hover、dark dialog actions、profile menu、video upload confirm），本次新增失败 0；Skill `quick_validate.py`、全部新增主进程文件 `node --check`、TypeScript 检查和 Vite production build 通过，构建转换 97 modules，仅保留既有大 chunk 提示；目标差异/新文件空白检查通过。
- 开发版：已清理仅剩端口进程、重新启动完整开发链路；Vite `127.0.0.1:5177` 监听与 Electron 主进程均实测为 1 个，当前打开的开发客户端已加载本次策略资源。没有执行 Windows 安装包构建或版本发布。
- 风险：江恩标尺与锚点选择对结果影响大，当前自动校准虽可复算但仍需不同品种、周期和波动状态的真实前向观察；Square of Nine 的小数尺度是显式产品约定，不等于已证明预测优势。当前自动测试验证数学和安全一致性，没有声称江恩方法拥有统计显著收益。
- 回滚：将 `gann-theory` 加入 `HAOLO_DISABLED_TRADING_STRATEGIES` 可停用单策略；完整回滚可移除策略包、Adapter、三个子引擎、公共上下文、总引擎/管线/Router、注册项、图标主题和专项测试，不涉及数据库、账户、订单、会话、用户绘图或其他策略迁移。
- Git/工作树：未提交；保留并避开用户工作树中其他既有改动。
- 下一任务：用户在开发版用 BTC/ETH 的 1H、4H、1D 运行 `@策略:江恩理论`，核对自动锚点、1x1、九线、方格分割、轮中轮和数字螺旋价位；随后进入 P7 Windows 100%/125%/150% 亮暗主题与真实行情前向验证。

### LOG-20260815-042：完成 M1-176 江恩文字与箱体碰撞避让

- 日期：2026-08-15。
- 状态变化：M1-176 `未开始 → 已完成`；P7 状态不变。
- 原因：通用 AI 文字布局器原先只登记订单流箱体和裸K结构为不可占用区域，江恩方格没有进入障碍集合，因此摘要文字可能被放进方格或轮中轮内部。
- 修复：新增可测试的江恩箱体识别规则；Renderer 把当前画布所有 `gann-theory` 矩形转换成屏幕碰撞区域。江恩 note 开启箱体避让，继续避让 K 线与已放置文字，并将引线水平距离限制为 360px，文字移出后仍能指回原始行情锚点。
- 未修改边界：没有修改江恩锚点、角度线、方格、轮中轮、Square of Nine、触发/止损/目标或 ExecutionPlanV1；订单流和裸K既有避让继续使用同一布局器。
- UI 主题：本次不新增颜色或控件，复用策略 note 的明暗主题 Token、普通字重和虚线引线；布局算法与主题无关，两种主题坐标一致。
- 测试证据：绘图与江恩定向 49/49；全部交易测试 465/465；TypeScript 检查通过；Vite production build 通过并转换 97 modules，仅保留既有大 chunk 提示。新增测试覆盖箱体识别、两条江恩文字均位于箱体外、互不重叠、引线不超过 360px；全仓非交易测试未因本次局部修复重复执行。
- 风险：当江恩方格几乎覆盖整个可视画布时，可用文字区域会受限；当前策略是优先使用四周空白，完全无空间时宁可不显示该 note，也不重新压回箱体内部。
- 回滚：删除 `tradingDrawingIsGannTheoryBox`、`visibleGannTheoryBoxObstacles` 和江恩 note 避让分支即可恢复原布局；不涉及策略数据、账户、订单或持久化格式。
- Git/工作树：未提交；保留并避开用户工作树中其他既有改动。
- 下一任务：用户在开发版重新运行同一 BTC/USDT 1小时江恩分析，确认摘要文字落在方格外且虚线目标清晰；随后继续 P7 多缩放与双主题实机视觉验收。

### LOG-20260815-043：完成 M1-177 ICT/SMC 独立 Skill 与零迁移接入

- 日期：2026-08-15。
- 状态变化：M1-177 `未开始 → 已完成`；P7 状态不变。
- 目标与实际范围：新增 `ict-smc` 官方策略包、独立 Adapter、严格 Request Router 和独立 Pipeline；复用既有 `ict-smc-engine.mjs` 的确定性市场结构、MSS/CHoCH、FVG、OB、Breaker、流动性池与清扫事实，不复制算法、不让模型生成价位。
- 订单流零迁移：`order-flow-pipeline.mjs`、`order-flow-engine.mjs` 和既有 `ict-smc-engine.mjs` 相对任务起点均无差异；ICT 独立 Pipeline 不导入订单流，报告明确声明不读取逐笔成交、深度或 CVD，不能把价格行为冒充订单流证据。
- 收盘与执行边界：主周期和高周期上下文在协议归一化前按 `snapshotTime` 过滤未收盘 K 线；输出统一受控结构路径、FVG/OB 区域、流动性价位、触发/失效和目标，但当前动作固定为等待，只有流动性清扫、位移、MSS/CHoCH 与有效 PD Array 回踩按序完成才允许后续人工执行。
- Skill 影响：按 `skill-creator` 创建 `strategy.json + SKILL.md + agents/openai.yaml + references/rules.md`，触发语义、非触发问题、证据顺序、反例和安全边界均固化在包内；UTF-8 模式下 `quick_validate.py` 通过。
- UI 主题：策略广场新增 ICT/SMC 内联图标及成对亮暗主题 Token，复用现有卡片 default、hover、active、focus-visible 和 disabled 状态；图表继续使用 Drawing Gateway 语义色，不新增硬编码浅色控件。
- 测试证据：ICT/SMT 新增定向 6/6；订单流、ICT 既有链路、运行时与 Skill 组合 42/42；全部交易测试 471/471；全仓 2185 项中 2180 通过、5 项失败与 BASE-003 登记集合一致，本次新增失败 0；语法、TypeScript 和 Vite production build 通过，构建转换 101 modules，仅保留既有大 chunk 提示。
- 风险：ICT/SMC 的术语容易被产品文案夸大为已知机构意图；当前实现只输出可复算的价格结构事实，并明确 FVG 是价格不平衡而非“无成交区”，OB 需要后续位移/结构结果，流动性清扫不证明主体身份。
- 回滚：将 `ict-smc` 加入 `HAOLO_DISABLED_TRADING_STRATEGIES` 可单独停用；完整回滚只移除新策略包、Adapter、Router、Pipeline、注册项与图标，不触及订单流、账户、订单、持久化或既有 ICT 结构引擎。
- Git/工作树：未提交；保留并避开用户工作树中其他既有改动。

### LOG-20260815-044：完成 M1-178 SMT 独立 Skill 与 Hyperliquid 只读对照行情

- 日期：2026-08-15。
- 状态变化：M1-178 `未开始 → 已完成`；P7 状态不变。
- 术语冻结：SMT 定义为 Smart Money Technique 的相关市场非同步确认，不使用“Smart Money Trap”作为正式名称。看跌 SMT 为一个市场创新高而相关市场未确认，看涨 SMT 为一个市场创新低而相关市场未确认；SMT 只提供方向确认，不是独立入场信号。
- 数据接入：新增 `HyperliquidPublicMarketService`，只允许固定 `POST https://api.hyperliquid.xyz/info` 的 `candleSnapshot` 请求；参数严格限制为 coin、官方 interval、startTime 和 endTime，并具备超时、短缓存和 Retry-After 处理。服务不包含签名、私钥、账户、下单、撤单或 WebSocket 交易接口。
- 配对语义：同币种 Binance/Hyperliquid 数据只计算跨场所收益相关性并校验行情错位，不能冒充经典 SMT；BTC 主图默认以 ETH 为相关市场、ETH 主图默认以 BTC 为相关市场。相关市场必须精确时间对齐达到 85%、对数收益相关系数至少 0.45、候选距当前不超过 18 根 K 线，否则降级为数据不足。
- 故障隔离：Renderer 仅在 SMT Manifest 请求 `comparison-candles` 时并行读取 Hyperliquid；采用 `Promise.allSettled`，失败时返回缺失对照数据并让 SMT 产出等待/数据不足报告，不影响 Binance 主图、ICT、订单流或其他策略。Hyperliquid 请求直接使用独立只读网络调用，不占用 Binance/订单流请求治理器。
- 快照与绘图：主图及上下文仅消费已收盘 K 线；组合快照指纹包含完整对照市场数据，避免对照行情变化后复用旧结果。绘图只在主图自己的 `ai/strategy/smt-divergence` 图层标记主市场极值、触发、失效和目标，不把 ETH 或 Hyperliquid 价格错误绘制到 BTC 坐标轴。
- 执行门禁：即使相关性和 SMT 背离都成立，`ExecutionPlanV1` 仍保持等待；必须在主市场看到同向位移、已收盘 MSS 和有效 FVG/OB 回踩后才具备执行条件，相关性跌破阈值、两市场重新同步创新高/低、主结构反向或超过两根周期即取消。
- Skill 影响：按 `skill-creator` 创建 SMT 标准包和规则参考，`quick_validate.py` 通过；Skill 将 Hyperliquid 定义为可选只读数据源而非订单流来源，并规定缺数据必须安全降级。
- UI 主题：新增 SMT 策略卡内联图标及亮暗主题 Token；无新增表单、菜单或可交互数据源设置，继续复用现有卡片全部交互状态和图表语义色。
- 测试证据：SMT 新增用例覆盖相关性/对齐门槛、创新高非确认、无相关数据降级、仅主市场绘图、只读固定网关缓存、未收盘 K 线过滤、对照行情输入指纹、订单流无依赖和双主题；合并验收结果见 ICTSMT-001。
- 风险与遗留：v1 使用分析时 REST 快照而非持续 WebSocket，降低连接与限频风险；BTC/ETH 默认配对是首发约定，不代表所有币种都具备稳定相关性。其他资产需要基于历史滚动相关性维护显式配对表，并通过前向样本验收后才能启用。
- 回滚：将 `smt-divergence` 加入 `HAOLO_DISABLED_TRADING_STRATEGIES` 可单独停用；完整回滚移除 SMT 包、Adapter/Router/Engine/Pipeline、Hyperliquid 只读 IPC、Renderer 对照数据准备、注册项和图标，不涉及订单流数据库迁移或订单能力。
- Git/工作树：未提交；保留并避开用户工作树中其他既有改动。
- 下一任务：开发版分别用 BTC/ETH 的 15m、1H 和 4H 运行 `@策略:SMT`，核对跨市场时间对齐、只在主图绘制、自身无确认时明确等待；随后继续 P7 多缩放、双主题、断网/限频和真实行情前向验收。

### LOG-20260815-045：完成 M1-179 MACD 指标 Skill、八大经典形态与背离链路

- 日期：2026-08-15。
- 状态变化：M1-179 `未开始 → 已完成`；P7 状态不变。
- 架构：公共 Manifest 以向后兼容方式新增 `indicator` 分组和只读 `chartIndicator` 描述；Registry/Coordinator/IPC 不复制，策略列表继续只返回策略卡，指标列表独立返回指标卡。新增 `macd-analysis` 官方 Skill、Adapter、Router、确定性 Engine 和 Pipeline；未修改订单流、ICT/SMC、SMT、预警计算或现有 MACD 副图公式。
- 公式与数据：严格复用产品现有 SMA 种子 EMA 计算，参数固定为 12/26/9，DIF=`EMA12-EMA26`、DEA=`EMA9(DIF)`、柱体=`DIF-DEA`。仅已收盘 K 线参与交叉、形态、背离、绘图和执行条件；未收盘 K 线排除并在报告披露。
- 经典形态：冻结并实现佛手向上、小鸭出水、漫步青云、天鹅展翅、空中缆绳、空中缆车、海底电缆、海底捞月八种顺序规则，条件包含 DIF/DEA 交叉顺序、零轴位置、粘合/未死叉、柱体收缩后扩张和有界时效。名称只解释几何序列，不声称主力行为或保证买点。
- 背离：实现确认摆动上的常规顶背离、常规底背离、隐藏看涨背离和隐藏看跌背离；要求右侧 K 线确认、最小摆动幅度、最小指标差和有界间隔，柱体同向只提升证据质量，不强行补齐背离。
- UI 与绘图：指标页由 Indicator Catalog 新增 MACD 已安装卡片和 `@指标:MACD` 二级入口；点击进入交易专家并预填 mention，执行分析时自动打开现有 MACD(12,26,9) 副图。价格侧只在 `ai/strategy/macd-analysis` 隔离层绘制背离连线、形态说明、触发、失效和目标；没有形态时明确显示等待说明。浅色使用紫色浅底/深紫线，暗色使用紫色透明底/浅紫线，复用卡片 default、hover、active、focus-visible、disabled 状态。
- 执行方案：统一 `ExecutionPlanV1` 保持条件式等待；MACD 只作为趋势/动能证据，必须等待已收盘 K 线突破最近价格结构边界。结构反向、DIF/DEA 反向交叉、频繁交叉、数据过期或四个当前周期到期均取消；缺少账户权益与合约规格时不猜仓位数量。
- 知识边界：计算、零轴/交叉和背离以 TradingView、Fidelity 与中国投资者教育资料交叉核对；八大中文组合按中国铁道出版社相关 MACD 教材目录及公开一致规则冻结。用户提供的雪球页面保留为需求来源，但公开抓取无法取得正文，因此未把不可复核描述直接编码。
- 测试证据：新增 6 项覆盖公式与既有警报/图表计算完全一致、确认顶底背离、八种经典形态逐一可达、未收盘过滤、隔离绘图、等待型执行方案、独立指标注册、自动副图、卡片 mention 与双主题。Skill 官方 `quick_validate.py` 通过；新增主进程文件 `node --check`、TypeScript 和 Vite production build 通过（103 modules，仅既有大 chunk 提示）；交易全域最终结果见 MACD-001；全仓失败必须保持 BASE-003 的 5 项既有集合。
- 风险：八大中文形态不是跨市场统一标准，零轴“附近”和 DIF/DEA“粘合”必须使用尺度归一阈值；加密市场连续交易与传统股票成交量/均线背景不同，因此 v1 不把传统配套描述作为硬触发。真实行情仍需在 BTC/ETH 的 15m、1H、4H、1D 做前向命中率、重复标注和震荡误报观察。
- 回滚：将 `macd-analysis` 加入 `HAOLO_DISABLED_TRADING_STRATEGIES` 可单独停用；完整回滚可移除新 Skill 包、Adapter、Router、Engine/Pipeline、指标卡与清单分组扩展，不涉及数据库、账户、订单、用户绘图、预警或其他策略迁移。
- Git/工作树：未提交；保留并避开用户工作树中其他既有改动。
- 下一任务：开发版分别在 BTC/ETH 的 15m、1H、4H、1D 使用 `@指标:MACD`，核对八大形态、顶底/隐藏背离、自动副图和价格证据连线；随后进入 P7 双主题、多缩放与真实行情前向验收。

### LOG-20260815-046：完成 M1-180 MACD 背离绘图协议错误修复

- 日期：2026-08-15。
- 状态变化：M1-180 `未开始 → 已完成`；P7 状态不变。
- 现场根因：截图中的 MACD 计算、报告和副图已经完成，失败发生在 Drawing Gateway 校验阶段。看跌类顶背离/隐藏看跌背离的第一条价格连线被错误映射成 `strategy-alternative`；该颜色属于波浪理论专用语义，不在通用策略协议允许的 `primary/support/resistance/entry/stop/target/note` 集合内，因此确定性抛出 `operations[0] uses an unsupported strategy drawing style`。
- 修复：不放宽协议白名单，也不绕过 Drawing Gateway；仅在 `macd-analysis` Pipeline 内把看涨类背离映射为 `strategy-support`、看跌类背离映射为 `strategy-resistance`。订单流、波浪理论、ICT/SMC、SMT、其他策略绘图协议和 UI/CSS 均未修改。
- 防回归：新增协议级用例，逐一构造常规顶背离、常规底背离、隐藏看跌背离、隐藏看涨背离，并要求四条连线完成完整 `validateStrategyDrawingPatch` 校验且颜色顺序精确为 resistance/support/resistance/support；此前测试只验证自然行情 Pipeline，没有强制覆盖看跌背离首操作，现已补齐该缺口。
- 验收：MACD 专项 7/7、全部 `trading-*` 478/478、`node --check`、TypeScript 和 Vite production build（103 modules）通过；仅保留既有大 chunk 提示。开发版已冷重启并加载新主进程代码。
- 回滚：仅需回退 MACD 背离角色的一行映射和对应测试；没有数据迁移、持久化变化或其他策略风险。
- Git/工作树：未提交；保留并避开用户工作树中其他既有改动。

### LOG-20260815-047：完成 M1-181 MACD 主图/副图绘图坐标解耦

- 日期：2026-08-15。
- 状态变化：M1-181 `未开始 → 已完成`；P7 状态不变。
- 现场根因：MACD Engine 已经计算 DIF/DEA/柱体坐标，但 Pipeline 把背离、八大经典形态和说明文字转换成 K 线价格点，并交给只认识主图价格轴的通用 `TradingDrawingController`，所以形态被稳定地画在 K 线区；这不是 MACD 识别误差，而是目标 Pane 与坐标协议错误。
- 架构修复：新增严格的 `indicatorDrawingPatch`，目标明确包含 `indicatorId=macd`，点位使用 `{time,value}` 而不是 `{time,price}`，允许零轴和负值；协议仅允许 `path/note/text`、既有策略语义颜色、有限线宽/字号和隔离图层。MACD Pipeline 现在把背离线、背离标签、佛手向上/小鸭出水/漫步青云/天鹅展翅/空中缆绳/空中缆车/海底电缆/海底捞月全部输出到该副图 Patch；主图 Patch 只包含收盘触发、失效/止损和分批目标。
- Renderer：不改造其他策略共用的主图 Controller；MACD Patch 在既有 `IndicatorPaneRuntime` 内原生增加 LineSeries，并把文字 Marker 绑定 DIF 系列，时间坐标继续与主图共享，数值坐标由 MACD Pane 自己换算。切换周期/品种会按目标身份隐藏不匹配 Patch，重建 Pane 和切换亮暗主题时会清理旧 Series/Marker 后重绘，避免泄漏、重复和主题颜色滞留。
- 历史残留：新主图执行 Patch 会按原有市场+周期替换旧 AI 画线；当本次没有任何执行价位时，显式只清理当前 `macd-analysis` 的旧主图形态，避免升级前的错误 MACD 标注继续残留，同时不清除用户手动画线和其他市场/周期内容。
- 未修改边界：MACD 12/26/9 公式、形态/背离识别、已收盘门禁、报告、ExecutionPlan、订单流、ICT/SMC、SMT、其他策略算法、账户与下单能力均未修改；没有数据库或配置迁移。
- 亮色/暗色：未新增 CSS 或硬编码单主题颜色；副图线和文字直接读取现有 `--trading-ai-strategy-*` 成对 Token，主题切换强制重建副图分析 Series/Marker，亮色保持深紫等语义色，暗色保持浅紫等高对比色。
- 测试证据：MACD 专项 8/8，新增零轴/负值协议、主副图隔离和 Renderer 接线断言；绘图/运行时/MACD 组合 65/65；全部 `trading-*` 479/479；`pnpm run typecheck`、Vite production build（103 modules，仅既有大 chunk 提示）和目标 `git diff --check` 通过。
- 风险：副图分析标记当前只在主 Pane 的 MACD 副图显示；分屏继续保留各自的主图执行线，但本次为避免扩大 `TradingExpertSplitPane` 改造面，没有把指标侧标记注入辅助分屏。该限制不影响当前用户截图对应的主分析链路，也不会把副图值误画为价格。
- 回滚：回退 `indicatorDrawingPatch` 协议、MACD Pipeline 分流和 Renderer 的副图 Series/Marker 即可恢复 M1-180；无数据迁移。也可单独将 `macd-analysis` 加入 `HAOLO_DISABLED_TRADING_STRATEGIES` 停用该指标。
- Git/工作树：未提交；保留并避开用户工作树中其他既有改动。
- 下一任务：在开发版重新运行同一 ETH/USDT 1H `@指标:MACD`；验收点为紫色背离/经典形态文字及连线只出现在底部 MACD 副图，K 线主图只保留触发、止损/失效和目标位。随后进入 P7 多周期、多缩放及亮暗主题实机验收。

### LOG-20260815-048：完成 M1-182 布林带 Indicator Skill 完整链路

- 日期：2026-08-15。
- 状态变化：M1-182 `未开始 → 已完成`；P7 状态不变。
- 架构与最小风险边界：新增独立 `bollinger-bands-analysis` 指标包、Adapter、严格 Request Router、确定性 Engine、Pipeline、受控绘图和专项测试；复用既有 Registry/Coordinator、指标目录、行情快照、Drawing Gateway 与 `ExecutionPlanV1`，未新增 IPC、未修改订单流、MACD、ICT/SMC、SMT 或其他策略算法。
- 公式一致性：把告警系统原内联 BOLL 计算抽成共享 `computeBollingerBands`，告警注册表和新分析引擎共同使用 SMA(20) 与 2 倍总体标准差；Renderer 现有主图 BOLL 计算已由原回归锁定相同公式。分析同时计算 `%B=(close-lower)/(upper-lower)` 与 `BandWidth=(upper-lower)/middle`，避免图表、预警与分析出现三套值。
- 知识冻结：依据 John Bollinger 官方规则固化“触轨不是信号”“沿带运行可持续”“外轨外收盘初始视作延续”“传统中轨使用 SMA”“%B 描述相对位置”“BandWidth 识别低波动”。低带宽本身不猜方向；缩口突破要求两根同向外轨外已收盘 K 线和带宽扩张。M 顶/W 底要求确认摆动、第一次触及外轨、第二次未获外轨确认及后续收盘突破颈线；假突破要求越轨后三根内收回并穿越中轨。
- 收盘与成功语义：所有状态、形态、绘图和执行价位只消费完整结束的 K 线，实时未收盘极值不参与。未找到形态是正常成功结果，报告明确等待且不强行贴名；单次上轨/下轨触碰不会被解释成超买/超卖或反转。
- UI 与绘图：指标页自动新增“布林带”已安装卡片，点击生成 `@指标:布林带` 并自动开启既有主图 BOLL(20,2)。原生三轨继续由现有图表指标绘制；Skill 只在 `ai/strategy/bollinger-bands-analysis` 隔离层补充形态路径、缩口观察区、确认标签、触发/失效和 1R/2R 目标，避免重复覆盖三轨。
- 执行方案：当前动作固定为条件式等待。确认缩口突破、M/W 或假突破后，仍需下一根已收盘价格完成再确认；失效位来自第二极值或压缩区另一侧，目标由真实触发—失效风险计算。沿带运行不追价；没有完整触发、失效与正价格目标时不生成交易场景，缺少账户权益与合约规格时不猜仓位数量。
- Skill 影响：按 `skill-creator` 官方脚手架创建 `strategy.json + SKILL.md + agents/openai.yaml + references/rules.md`；默认 Prompt 显式引用 `$bollinger-bands-analysis`。系统 Python 的 PyYAML 环境下 `quick_validate.py` 通过；Bundled Python 首次校验因缺少 PyYAML 失败，随后使用已安装 PyYAML 的系统 Python完成同一官方校验，未绕过规则。
- 亮色/暗色：新增布林带卡片图标的成对主题 Token，浅色为淡蓝底/深蓝线，暗色为蓝色透明底/浅蓝线；卡片继续复用既有 default、hover、active、focus-visible、disabled 状态。图表标注继续使用 Drawing Gateway 成对策略语义色，无硬编码单主题绘图颜色。
- 测试证据：布林带专项 9/9；与 MACD、运行时、Skill 目录组合 40/40；全部 `trading-*` 488/488；全仓 2202 项中 2197 通过、5 个失败名称与 BASE-003 完全一致，新增失败 0。`quick_validate.py`、四个新增主进程文件 `node --check`、`pnpm run typecheck`、Vite production build（105 modules，仅既有大 chunk 提示）和 `git diff --check` 均通过。
- 开发版：已完整停止旧开发进程并冷启动；Vite `127.0.0.1:5177` 正常监听，Electron 主进程与 Renderer 均已启动。运行时实测 `bollinger-bands-analysis` Manifest 启用、Adapter 可用、`chartIndicator={id:boll,scope:main,parameters:[20,2]}` 且 Registry 无诊断。Chrome Native Host 缺失和 Windows 快捷方式修复告警为既有非指标告警，不阻断本链路。
- 风险：低带宽百分位、摆动半径、相似高低点容差与沿带窗口是可复算的首版产品参数，并不证明预测优势；不同币种和周期仍需 BTC/ETH 15m、1H、4H、1D 的真实前向命中率、重复标注和震荡误报观察。Windows 100%/125%/150% 与实际亮暗主题视觉仍保留为 P7 门禁。
- 回滚：将 `bollinger-bands-analysis` 加入 `HAOLO_DISABLED_TRADING_STRATEGIES` 可单独停用；完整回滚可移除新指标包、Adapter、Router、Engine/Pipeline、注册项、图标主题和专项测试，并把 BOLL 告警注册恢复为原内联公式。无数据库、账户、订单、会话、用户绘图或其他策略迁移。
- Git/工作树：未提交；保留并避开用户工作树中其他既有改动。
- 下一任务：开发版在 BTC/ETH 的 15m、1H、4H、1D 使用 `@指标:布林带`，核对原生三轨、低带宽区、连续收盘突破、M/W 结构和等待型执行方案；随后进入 P7 多缩放、双主题和真实行情前向验收。

### LOG-20260815-049：完成 M1-183 均线 Indicator Skill 完整链路

- 日期：2026-08-15。
- 状态变化：M1-183 `未开始 → 已完成`；P7 状态不变。
- 架构与最小风险边界：新增独立 `moving-average-analysis` 指标包、Adapter、严格 Request Router、确定性 Engine、Pipeline、受控绘图和专项测试；复用既有 Registry/Coordinator、行情快照、Drawing Gateway、指标目录与 `ExecutionPlanV1`，未新增 IPC，未修改订单流、MACD、布林带或其他策略算法。
- 公式一致性：分析引擎直接复用现有 `indicatorSma`，以已收盘 K 线计算 SMA5/20/60；Manifest 声明 `chartIndicator={id:ma,scope:main,parameters:[5,20,60]}`，调用时由原生主图指标绘制同一组均线，Skill 隔离层不重复画三条全长均线。
- 知识冻结：依据 Fidelity 与 StockCharts 的均线资料，固化“均线平滑历史价格且天然滞后”“周期越长响应越慢”“交叉在震荡区容易反复失效”“价格对均线的支撑/阻力应按区域而非精确点处理”。主场景覆盖多头/空头排列、经下一根已收盘 K 线持续确认的 MA5/MA20 金叉与死叉、低宽度压缩后伴随斜率的有序发散，以及趋势方向一致的 MA20 回踩/拒绝；价格或 MA60 交叉仅作为背景观察，不独立触发执行。
- 收盘与成功语义：所有状态、形态、绘图和执行价位只消费完整结束的 K 线；实时未收盘尖刺不会确认交叉或回踩。未找到有效场景是正常成功结果，报告明确“等待”而不强行贴形态；单根交叉、无斜率发散和逆趋势触碰均不升级为执行场景。
- UI 与绘图：指标页自动新增“均线”已安装卡片，点击生成 `@指标:均线` 并自动开启原生主图 MA(5,20,60)。Skill 仅在 `ai/strategy/moving-average-analysis` 隔离层补充交叉/回踩证据、MA20 观察区、压缩区、确认标签以及触发、失效和 1R/2R 目标；标签使用 0.8 指引虚线并按时间/ATR 偏移，降低与 K 线、均线和相邻文字重叠。
- 执行方案：当前动作固定为条件式等待。确认场景之后仍要求下一根已收盘价格站稳/跌破触发位且结构不失效；止损来自场景摆动点或 MA20 容差区外，目标由真实触发—失效风险计算。若触发、失效、方向或正价格目标不完整，则不生成交易场景；缺少账户权益与合约规格时不猜仓位数量，也不产生订单。
- Skill 影响：遵循 `skill-creator` 的标准目录和元数据约束，由官方脚手架创建 `strategy.json + SKILL.md + agents/openai.yaml + references/rules.md`，默认 Prompt 显式引用 `$moving-average-analysis`。Windows 默认代码页首次生成中文 `openai.yaml` 时写入失败，随后仅设置 `PYTHONUTF8=1` 重跑官方生成脚本成功；官方 `quick_validate.py` 校验通过，未手工绕过元数据规则。
- 亮色/暗色：新增均线卡片图标的成对主题 Token，浅色为暖黄底/棕黄色线，暗色为黄色透明底/浅黄色线；卡片继续复用既有 default、hover、active、focus-visible、disabled 状态。图表标注继续使用 Drawing Gateway 成对策略语义色，不引入只适用于浅色的硬编码文字或背景。
- 测试证据：均线专项 10/10；全部 `trading-*` 498/498；全仓 2212 项中 2207 通过、5 个失败名称与 BASE-003 完全一致，新增失败 0。`quick_validate.py`、四个新增主进程文件 `node --check`、`pnpm run typecheck`、Vite production build（107 modules，仅既有大 chunk 提示）和 `git diff --check` 均通过。
- 开发版：已完整停止旧开发进程并冷启动；Vite `127.0.0.1:5177` 正常监听，Electron 主进程与 Renderer 均已启动。运行时实测 `moving-average-analysis` Manifest 启用、Adapter 可用、`chartIndicator={id:ma,scope:main,parameters:[5,20,60]}` 且 Registry 无诊断。Chrome Native Host 缺失、Windows 快捷方式修复和 Chromium Autofill 告警为既有非指标告警，不阻断本链路。
- 风险：5/20/60 参数、压缩百分位、斜率阈值、ATR 回踩容差和持续确认窗口是可复算的首版产品规则，不代表历史或未来收益；均线在震荡行情仍会滞后并产生鞭打。BTC/ETH 的 15m、1H、4H、1D 真实前向误报率、标签拥挤和不同缩放视觉仍保留为 P7 门禁。
- 回滚：将 `moving-average-analysis` 加入 `HAOLO_DISABLED_TRADING_STRATEGIES` 可单独停用；完整回滚可移除新指标包、Adapter、Router、Engine/Pipeline、注册项、图标主题和专项测试。无数据库、账户、订单、会话、用户绘图或其他策略迁移。
- Git/工作树：未提交；保留并避开用户工作树中其他既有改动。
- 下一任务：开发版在 BTC/ETH 的 15m、1H、4H、1D 使用 `@指标:均线`，核对原生 SMA5/20/60、多空排列、持续确认交叉、压缩发散、MA20 回踩和等待型执行方案；随后进入 P7 多缩放、双主题和真实行情前向验收。

### LOG-20260815-050：完成 M1-184 均线金叉/死叉真实交点锚定修复

- 日期：2026-08-15。
- 状态变化：M1-184 `未开始 → 已完成`；P7 状态不变。
- 根因：确定性引擎正确地在 MA5/MA20 发生次序反转后等待下一根已收盘 K 线确认，但 Pipeline 把确认 K 线上的 MA5/MA20 均值作为指引线起点，又把带文字的 `note` 放在人工偏移标签点；Renderer 会把 `note` 自身的紫色圆点视为锚点，因此用户看到的圆点既不是均线交叉时刻，也不是均线交叉价格。
- 修复：新增 `movingAverageCrossoverPoint`，用交叉前样本差值 `d0=MA5-MA20` 与交叉后样本差值 `d1` 计算 `ratio=d0/(d0-d1)`，再在线段时间和两条均线价格上做同一比例插值。金叉与死叉 Pattern 固化不可变 `crossPoint={time,price}`；交叉标签的 `note` 直接锚定该点，不再生成指向偏移标签点的重复 Leader。Renderer 继续负责文字避让，并自动从真实交点紫色圆点以虚线指向避让后的文字。
- 语义边界：交叉发生时间/价格与交叉确认状态正式解耦。紫色圆点表示 MA5/MA20 的数学交点；“确认”仍必须来自其后一根已收盘 K 线保持同向，未降低收盘门禁，也未用未收盘 K 线提前确认。执行计划、MA60 背景过滤、其他均线形态、MACD、布林带、订单流和其他策略均未修改。
- Skill 影响：在 `references/rules.md` 增加交叉绘图锚点规范，明确必须使用交叉前后样本线段的线性插值点，不得把确认 K 线或文字偏移位置冒充真实交点；`SKILL.md` 与 `agents/openai.yaml` 的触发和界面元数据仍一致，无需再生成。官方 `quick_validate.py` 复核通过。
- 测试证据：新增金叉、死叉双向精确时间/价格断言，并验证 Drawing Patch 的 `note.points[0]` 等于各自 `crossPoint`、不存在旧偏移 Leader。均线专项 11/11；全部 `trading-*` 499/499；全仓 2213 项中 2208 通过、5 个失败名称严格等于 BASE-003，新增失败 0；TypeScript、两项主进程语法检查、Skill 校验、Vite production build（107 modules，仅既有大 chunk 提示）和 `git diff --check` 通过。
- 开发版：为避免全仓媒体契约测试与运行中的 Electron 争用资源，先完整停止开发进程后重跑全仓并取得稳定基线结果；随后冷启动开发版，Vite `127.0.0.1:5177`、Electron 主进程和 Renderer 正常启动。Chrome Native Host、Windows 快捷方式与 Chromium Autofill 仍为既有非均线告警。
- 回滚：仅需回退交点插值函数、Pattern 的 `crossPoint`、Pipeline 交叉锚点分支、规则增量和专项断言即可恢复 M1-183；无 Manifest、IPC、数据库、账户、订单、会话或用户绘图迁移。
- Git/工作树：未提交；保留并避开用户工作树中其他既有改动。
- 下一任务：开发版重新运行截图同类 ETH/USDT 1H `@指标:均线`，验收紫色圆点位于黄色 MA5 与青色 MA20 连线的实际交点，文字可避让但虚线必须回指该圆点；随后抽查 BTC/ETH 15m、1H、4H、1D 的双向交叉。

### LOG-20260815-051：完成 M1-185 RSI Indicator Skill 完整链路

- 日期：2026-08-15。
- 状态变化：M1-185 `未开始 → 已完成`；P7 状态不变。
- 知识冻结：依据 Fidelity RSI 指标指南与 StockCharts ChartSchool 冻结 Wilder RSI(14)、70/30、50 中轴、40–90/10–60 趋势区间、常规/隐藏背离和多空失败摆动。强趋势可长期停留极值区，单次超买/超卖不得成为反向入场信号。
- 实现：通过 `skill-creator` 官方脚手架创建 `rsi-analysis` Skill、Manifest、规则和界面元数据；新增独立 Engine、Pipeline、Request Router 与 Adapter，并注册到统一 Registry/Coordinator。引擎复用预警与原生副图的 Wilder 公式，只读取已收盘 OHLC；确定性输出阈值/中轴事件、趋势区间、四类确认背离与完整四段失败摆动。
- 绘图与执行：调用 `@指标:RSI` 自动展示 RSI(14) 副图；原生参考线补齐 50 中轴。背离连线、失败摆动路径和阈值标签使用 `{time,value}` 严格落在 `indicatorId=rsi` 副图及 `ai/strategy/rsi-analysis` 隔离层，主图仅在存在合格场景时绘制收盘触发、失效/止损和 1R/2R 目标。无确认形态时分析仍成功并保持等待。
- 收盘门禁：引擎会排除当前未收盘 K 线；背离第二价格摆动必须有右侧两根已收盘 K 线确认并满足间隔、价格幅度及至少 2.5 RSI 点差；失败摆动必须按“极值、反弹/回落、次级摆动、突破中间摆动”四段顺序收盘完成。
- UI 与主题：指标目录新增 RSI 卡片和独立 SVG；亮色使用浅紫底/深紫前景，暗色使用半透明深紫底/高对比浅紫前景，沿用卡片既有 default、hover、active/selected、focus、open、loading 与 disabled 状态。副图标注继续使用现有策略语义 Token，亮暗主题自动切换。
- 测试证据：RSI+运行时定向 23/23，RSI 专项 9/9，全部 `trading-*` 508/508；全仓 2222 项中 2217 通过、5 个失败名称严格等于 BASE-003，新增失败 0；Skill `quick_validate.py`、四项主进程 `node --check`、TypeScript、Vite production build（109 modules，仅既有大 chunk 提示）和 `git diff --check` 通过。
- 开发版：完整停止旧进程后冷启动，Vite `127.0.0.1:5177`、Electron 主进程和 Renderer 已加载本次 RSI Manifest/Adapter/UI；Chrome Native Host、Windows 快捷方式与 Chromium Autofill 仍为既有开发环境告警。
- 未修改边界：订单流、ICT/SMC、SMT、MACD、布林带、均线及其他策略的 Engine/Pipeline/图层未改；没有新增订单 API、账户凭据访问、数据库迁移或用户绘图迁移。
- 回滚：禁用 `rsi-analysis` 或回退其 Skill/Manifest、Adapter/Engine/Pipeline/Router、Registry 注册、RSI 卡片/双主题图标和 50 中轴增量即可；其他 Indicator Skill 与策略链路无需回滚。
- Git/工作树：未提交；保留并避开用户工作树中其他既有改动。
- 下一任务：开发版在 BTC/ETH 的 15m、1H、4H、1D 使用 `@指标:RSI`，核对副图数值、70/50/30、背离配对、失败摆动路径、无信号等待和主图仅执行价位；随后进入 P7 多缩放、双主题、真实行情前向和安装版门禁。

### LOG-20260815-052：完成 M1-186 RSI 副图小圆点与虚线引导标注

- 日期：2026-08-15。
- 状态变化：M1-186 `未开始 → 已完成`；P7 状态不变。
- 根因：RSI 的 `note` 直接使用 Lightweight Charts 默认圆形 Series Marker；未声明尺寸时默认值为 1，副图高度较小时视觉上会形成过大的实心圆，同时文字与真实 RSI 锚点之间没有独立引导线。
- 修复：指标绘图协议新增受限 `markerSize` 外观字段，仅允许 `note/text` 使用且范围为 0.1–2。RSI 每条注释拆为两项隔离操作：真实 RSI 值上的 `0.35` 小圆点及自动偏移文字、从邻近引导位置连接到真实点的 `0.8` 细虚线。Renderer 只在显式声明 `markerSize` 时使用精确 `price/value` 锚定；MACD 等未声明该字段的既有指标继续保持原渲染路径。
- 布局：虚线引导端在已收盘 K 线范围内按左右距离与 RSI 纵向通道交替偏移，限制在 2–98；文字由 Marker 按上下通道自动偏移但圆点始终锚定真实 RSI 值，避免为了放置文字再生成第二个圆点。
- Skill 影响：`rsi-analysis/SKILL.md` 固化“小圆点 + 细虚线 + 偏移文字”的输出约束；官方 `quick_validate.py` 复核通过。未修改 RSI 公式、背离/失败摆动识别、收盘门禁、执行方案、主图价位或其他策略。
- 主题：颜色继续由 `strategy-note/support/resistance` 双主题 Token 解析；本次没有新增硬编码浅色或暗色，大小、引导线和坐标行为在两种主题一致。
- 测试证据：专项断言验证单一小圆点 `0.35`、引导虚线 `0.8/dashed`、真实目标—邻近引导双点坐标，并拒绝 0 或大于 2 的无效尺寸；RSI+运行时定向 23/23，交易全域 508/508；全仓 2222 项中 2217 通过、5 个失败严格等于 BASE-003，新增失败 0。Skill 校验、协议/管线语法、TypeScript 和 Vite production build（109 modules，仅既有大 chunk 提示）通过。
- 回滚：回退 `markerSize` 协议字段、Renderer 显式精确锚定分支、RSI 三层注释生成和专项断言即可恢复 M1-185；无 Manifest、IPC、数据库、订单、账户、会话或用户绘图迁移。
- Git/工作树：未提交；保留并避开用户工作树中其他既有改动。
- 下一任务：开发版重新运行 ETH/USDT 1H `@指标:RSI`，验收圆点明显缩小且每个文字均由细虚线回指真实 RSI 点；再抽查 BTC/ETH 15m、1H、4H、1D 和亮暗主题。

### LOG-20260815-053：完成 M1-187 RSI 副图文字下排与空白区避让

- 日期：2026-08-15。
- 状态变化：M1-187 `未开始 → 已完成`；P7 状态不变。
- 根因：M1-186 已缩小真实 RSI 点并增加虚线，但文字仍附着在真实点附近并按上下交替放置；当背离、失败摆动和中轴事件集中在 45–55 区间时，多条文字会同时占用 RSI 曲线最密集的中部区域，形成截图中的叠字。
- 修复：每条注释现在拆为三层：真实 RSI 值上的 `0.35` 小圆点、从真实点到标签锚点的 `0.8/dashed` 引导线、位于标签锚点的纯文字。标签按 44、38、32、26、20 五个低位行逐层向下排列；超过五条时进入第二横向通道，不继续向 0 轴压缩副图。每个横向候选位置会比较前后五个 RSI 样本与标签行的净空，并对已占用的近邻位置施加碰撞惩罚，优先选择局部空白处。
- Renderer 与协议：`markerSize=0` 仅被限定为 `text` 的合法“只绘文字、不绘形状”语义，普通 `note` 仍要求至少 0.1，真实数据点保持 `0.35`；Renderer 对零尺寸文字锚点使用精确 RSI 值和中间定位，并仅将 RSI Marker 容量从 8 提高到 16，以覆盖最多八组“点 + 文字”。MACD、布林带、均线和其他策略仍沿用原容量和渲染分支。
- Skill 与主题：`rsi-analysis/SKILL.md` 固化“下方分层、局部空白优先、文字锚点不显示第二圆点”的规范。颜色继续由现有 `strategy-note/support/resistance` 亮暗主题 Token 解析，未增加硬编码浅色背景、文字或边框。
- 测试证据：新增八组标签压力用例，断言行序为 `44/38/32/26/20` 后换列复用 `44/38/32`、第二列时间锚点不同、每条虚线终点等于对应文字锚点且文字 Marker 尺寸为 0。RSI+运行时定向 24/24、交易全域 508/508；全仓 2223 项中 2218 通过、5 个失败严格等于 BASE-003，新增失败 0；协议/管线语法、TypeScript 和 Vite production build（109 modules，仅既有大 chunk 提示）通过。
- 未修改边界：RSI 公式、背离/失败摆动/阈值识别、已收盘门禁、执行方案、主图价位、订单流和其他策略均未修改；无数据库、订单、账户、会话或用户绘图迁移。
- 回滚：回退 RSI 标签行/空白评分、三层注释、零尺寸 Marker 协议与 Renderer RSI 容量分支即可恢复 M1-186。
- Git/工作树：未提交；保留并避开用户工作树中其他既有改动。
- 下一任务：开发版在截图同类 BTC/USDT 1H 重新调用 `@指标:RSI`，验收文字从上到下分层、优先离开 RSI 曲线密集区、无第二圆点且每条虚线准确回指真实小圆点；随后抽查亮暗主题与 15m/4H/1D。

### LOG-20260815-054：完成 M1-188 RSI 副图虚线防交叉

- 日期：2026-08-15。
- 状态变化：M1-188 `未开始 → 已完成`；P7 状态不变。
- 根因：M1-187 为每条标签独立搜索左右空白时间位置；当多个真实 RSI 点与其标签时间位置的横向顺序不同，直线引导段会在副图中交叉。局部净空评分无法从几何上保证全局不交叉。
- 修复：保留真实点 `0.35` 小圆点、44/38/32/26/20 下方分层和纯文字锚点；标签锚点改为与真实 RSI 点严格使用同一 candle time，引导线因此成为同一时间轴上的垂直 `0.8/dashed` 线。不同时间的垂直线互相平行，同时间事件只会共线，不会交叉。
- Skill 影响：按照 Skill 规范同步更新 `rsi-analysis/SKILL.md`，将同一时间坐标写成强制绘图契约。未修改 Wilder RSI 公式、阈值、背离、失败摆动、执行价位或收盘门禁。
- 测试证据：压力用例断言每条 Leader 起点等于真实小圆点、终点等于文字锚点，且起止 time 完全相等；RSI/KDJ/运行时定向 33/33、交易全域 518/518；全仓 2232 项中 2227 通过、5 项严格等于 BASE-003，新增失败 0。RSI Skill 校验、语法、类型、111 modules 生产构建和空白检查通过。
- 主题与边界：继续使用既有 `strategy-note/support/resistance` 亮暗 Token，没有新增硬编码绘图色；订单流、MACD、布林带、均线、策略引擎、IPC、账户与订单能力未改。
- 回滚：仅回退 RSI 标签锚点函数和对应 Skill/测试即可恢复 M1-187；没有数据库、会话或用户绘图迁移。

### LOG-20260815-055：完成 M1-189 独立 KDJ Indicator Skill 全链路

- 日期：2026-08-15。
- 状态变化：M1-189 `未开始 → 已完成`；P7 状态不变。
- 知识边界：依据 StockCharts/Fidelity 随机指标资料与项目已有原生/预警实现，冻结 KDJ(9,3,3) 递推：K/D 初值 50，J=`3K-2D` 且不截断；80/20 只表示极值动量，趋势中允许钝化。交叉、出区、背离均不能单独下单。
- 解耦实现：通过 `skill-creator` 官方脚手架创建 `kdj-analysis`，补齐独立 Manifest、Skill、规则、Engine、Pipeline、Request Router 与 Adapter，并注册到统一 Registry/Coordinator。未增加 KDJ 专用 IPC，也没有修改订单流或其他 Indicator Skill 的 Engine/Pipeline。
- 确定性分析：复用 `computeKdj` 同源公式；识别 K/D 金叉/死叉并线性插值得到两线真实交点，区分低位金叉/高位死叉和仅观察的中位交叉；识别 D 线常规/隐藏顶底背离、D 线 80/20 出区、J 线 0/100 极值以及连续三根以上 K/D 高低位钝化。全部只使用已收盘 K 线，价格摆动需要两根右侧 K 线确认。
- 绘图与执行：调用 `@指标:KDJ` 自动开启原生 KDJ 副图并显示 80/50/20 参考线。副图使用与 RSI 相同的真实值 `0.35` 小圆点、同 time 的 `0.8/dashed` 防交叉垂直引线、44/38/32/26/20 分层纯文字；主图只绘制收盘触发、结构失效和 1R/2R 目标。无有效证据时分析成功并保持等待，KDJ 永不直接下单。
- 主题与交互：指标卡新增独立 KDJ SVG，亮色使用浅蓝底/深蓝线，暗色使用深蓝透明底/浅蓝线；卡片 default、hover、active、focus、installed 和键盘状态继续复用指标卡统一契约。副图颜色继续通过策略语义 Token 自动适配亮暗主题。
- 测试证据：KDJ 专项 9/9；RSI/KDJ/运行时组合 33/33；交易全域 518/518；全仓 2232 项中 2227 通过、5 项严格等于 BASE-003（画布入口、会话行主题、暗色弹窗、资料菜单、视频附件确认），新增失败 0。KDJ/RSI Skill `quick_validate.py`、四项新增主进程 `node --check`、TypeScript、Vite production build（111 modules，仅既有大 chunk 提示）和 `git diff --check` 通过。
- 回滚：可单独禁用 `kdj-analysis`，或回退其 Skill/Manifest、Adapter/Engine/Pipeline/Router、Registry 注册、KDJ 卡片/双主题图标、参考线与 Marker 容量增量；其他策略和指标无需回滚。
- 下一任务：开发版在 BTC/ETH 的 15m、1H、4H、1D 分别调用 `@指标:RSI` 与 `@指标:KDJ`，人工核对多标签无交叉、K/D 交点、80/50/20、J 超界、无信号等待和主图仅执行价位，再进入安装版门禁。

### LOG-20260815-056：完成 M1-190 KDJ/RSI 副图引线严格时间升序修复

- 日期：2026-08-15。
- 状态变化：M1-190 `未开始 → 已完成`；P7 状态不变。
- 根因：M1-188 为了从几何上消除 RSI 引线交叉，把引线起点和终点设置成完全相同的 candle time；KDJ 复用了该样式。Lightweight Charts 的 LineSeries 要求 `setData` 中相邻点时间严格递增，因此同时间的垂直引线在绘制阶段触发 `data must be asc ordered by time`，导致分析结果已生成但盘面提交失败。
- 修复：RSI/KDJ 生成端保持小圆点和文字 Marker 锚定原 candle time，仅把 `0.8/dashed` 引线的文字侧终点增加 1 秒。相对于 1 分钟及以上 K 线，该偏移视觉上仍为垂直平行线，不会交叉。Renderer 新增通用严格升序归一化，若未来 Indicator Skill 再返回重复或逆序时间，会稳定排序并把碰撞点依次微移 1 秒，不再让整次分析失败。
- Skill 影响：同步更新 RSI/KDJ Skill 绘图契约为“原 K 线文字锚点 + 引线终点 1 秒微偏移”；公式、K/D 交叉点、背离、阈值、未收盘门禁、执行方案和亮暗主题颜色均未改变。
- 测试证据：新增每条 Indicator path 时间必须严格递增的回归断言；RSI/KDJ 专项 19/19、指标/运行时定向 60/60、交易全域 518/518；全仓 2232 项中 2227 通过、5 项严格等于 BASE-003，新增失败 0。双 Skill `quick_validate.py`、管线 `node --check`、TypeScript、Vite production build（111 modules，仅既有大 chunk 提示）和 `git diff --check` 通过。
- 主题与边界：未引入新的颜色、背景、边框或交互状态，副图继续复用现有浅色/暗色策略语义 Token；未修改订单流、账户、订单、数据库、会话或用户绘图。
- 回滚：仅回退 RSI/KDJ 引线时间微偏移、Renderer 升序兜底和对应 Skill/测试即可；无数据迁移。
- 下一任务：在开发版同一 ETH/USDT 1H 盘面重新调用 `@指标:KDJ`，验收分析完成、KDJ 副图出现小圆点/下排文字/细虚线且无交叉，再抽查 `@指标:RSI`。

### LOG-20260815-057：完成 M1-191 KDJ 指标卡展示文案中文化

- 日期：2026-08-15。
- 状态变化：M1-191 `未开始 → 已完成`；P7 状态不变。
- 根因：`kdj-analysis/agents/openai.yaml` 沿用了 Skill 脚手架生成时的英文 `display_name`、`short_description` 和 `default_prompt`，指标目录直接读取该展示元数据，因此只有 KDJ 卡片出现英文。
- 修复：标题统一为 `KDJ`，简介改为“分析KDJ金叉死叉、超买超卖、钝化状态与背离形态并生成条件执行方案”，默认调用提示同步改成中文。没有修改 Manifest id、提及词、分析算法、绘图、执行方案或任何主题颜色。
- Skill 影响：按照 Skill Creator 的 `agents/openai.yaml` 规范同步更新人类可见元数据，保留 `$kdj-analysis` 显式调用标识；没有增加冗余文档或资源。
- 测试证据：KDJ 与 Skill 目录定向 18/18；新增英文残留否定断言；KDJ Skill `quick_validate.py`、TypeScript、Vite production build（111 modules，仅既有大 chunk 提示）和 `git diff --check` 通过。
- 主题与边界：仅替换文字，卡片浅色/暗色 default、hover、active、focus、installed 与键盘状态继续使用原有主题样式；无需新增主题分叉。
- 回滚：仅回退 KDJ `agents/openai.yaml` 和对应测试；无数据迁移。

### LOG-20260815-058：完成 M1-196 VPVR Indicator Skill 与可见窗口信息分析

- 日期：2026-08-15。
- 状态变化：M1-196 `未开始 → 已完成`；P7 状态不变。
- 目标与实现：新增独立 `vpvr-analysis` Skill/Manifest、Adapter、严格 Request Router、确定性 Engine、Pipeline 和专项测试；注册到既有 Registry/Coordinator，调用 `@指标:VPVR` 自动开启原生主图 VPVR。没有复制 IPC、行情服务、原生覆盖层或订单流链路。
- 可见范围语义：主图分析直接消费 `visibleCandlesInLogicalRange` 返回的当前画布 K 线，而不是只取同样根数的最新 K 线；分屏分析同样使用各 Pane 自己的可见快照。通用快照协议仅增加可选最小根数参数，默认仍为 30，VPVR 独立使用 8 的协议下限；Manifest 产品门禁仍要求至少 20 根可见 K 线和有效成交量，其他策略行为不变。
- 算法同源：Engine 与原生 `trading-volume-profile.ts` 同为 96 个等距价格档，按 K 线高低价与档位的重叠比例分配全部成交量；POC 取最大成交量档，价值区从 POC 开始向相邻成交量更大的一侧扩展直至覆盖至少 70%。新增轻度平滑后的 HVN/LVN、POC/VAH/VAL/区间极值合并，以及当前价上下最多三组支撑/阻力；与现价重叠的接受区不会同时重复为支撑和阻力。
- 输出边界：可见报告固定只有“支撑位、阻力位、VPVR 市场信息”三类内容，解释 POC、VAH/VAL、HVN/LVN、价值区位置、市场接受度和上下方成交量分布；不输出多空方向、入场、止损、止盈、风险收益、仓位或订单。为兼容统一结果契约仍保留中性观察对象，但 Manifest 不声明 `execution-plan`，Coordinator 不会把标准执行方案前置到用户报告。
- 绘图与主题：原生 VPVR 柱形和 POC 继续使用 M1-195 的亮暗主题覆盖层；Skill 只在 `ai/strategy/vpvr-analysis` 隔离层增加最多三条支撑和三条阻力 `0.8/dashed` 水平线。指标目录新增独立 VPVR SVG 卡片图标及浅色/暗色成对 Token，卡片沿用既有 default、hover、active/selected、focus、open、loading、disabled 状态。
- Skill 影响：按 `skill-creator` 规范创建 `SKILL.md + references/rules.md + agents/openai.yaml + strategy.json`，默认 Prompt 显式调用 `$vpvr-analysis`；官方 `quick_validate.py` 通过。规则参考 TradingView 对 Volume Profile、POC、70% Value Area、HVN/LVN 和 Visible Range 自动重算的定义，并明确 OHLCV 档位分布是区间估算而非逐笔精度。
- 测试证据：原生与 Engine 的 96 个档位成交量、POC 和价值区逐项一致；20 根窄可见窗口、未收盘描述性 K 线、支撑阻力侧别、报告禁用字段、主图受控绘图、Registry/Coordinator、可见范围、双主题和 Skill 元数据均有回归。VPVR+运行时 21/21；全部 `trading-*` 528/528；全仓 2238 项中 2233 通过，5 个失败名称严格等于 BASE-003，新增失败 0。Skill 校验、四项 `node --check`、TypeScript、Vite production build（114 modules，仅既有大 chunk 提示）和 `git diff --check` 通过。
- 开发版：已只停止并冷启动 `dev.mjs → Vite → Electron` 进程树；没有中断独立的 24 小时行情浸泡任务。Vite `127.0.0.1:5177` 正常监听，Electron 主进程启动；当前日志只有既有 SQLite ExperimentalWarning 与开发环境 Chrome Native Host 缺失告警，均不阻断 VPVR 链路。
- 风险与遗留：VPVR 对可见窗口高度敏感，缩放、平移和新增成交都会改变节点；OHLCV 无法知道单根 K 线内部的真实成交价格，因此当前重叠分配只能作为确定性估算。HVN/LVN 百分位和支撑阻力合并容差是首版可复算参数，不证明预测优势；Windows 100%/125%/150%、BTC/ETH 15m/1H/4H/1D 与安装版仍保留为 P7 人工门禁。
- 回滚：将 `vpvr-analysis` 加入 `HAOLO_DISABLED_TRADING_STRATEGIES` 可单独停用分析 Skill；完整回滚可移除 VPVR 包、Adapter/Router/Engine/Pipeline、注册项、图标主题、可见窗口请求字段和专项测试，不需要回滚 M1-192 至 M1-195 的原生 VPVR，也没有数据库、账户、订单、会话或用户绘图迁移。
- Git/工作树：未提交；保留并避开用户工作树中其他既有改动。
- 下一任务：在开发版用 `@指标:VPVR` 抽查 BTC/ETH 15m、1H、4H、1D，验证平移到历史区间后报告确实随屏幕窗口改变、水平线与 POC/价值区一致且没有执行方案字段；随后完成多缩放、双主题和安装版门禁。

## 9. 后续完成记录模板

复制以下模板追加到第 8 节末尾，不覆盖旧记录：

```markdown
### LOG-YYYYMMDD-NNN：完成/启动/阻塞 TSK-...

- 日期与时间：
- 状态变化：
- 目标与实际范围：
- 修改文件：
- 未修改边界：
- 验收项及证据：
  - [ ] ...
- 测试证据：
  - 命令：
  - 结果：
  - 报告/截图/Fixture：
- 新旧行为等价结论：
- 亮色/暗色与交互状态结论：
- 已知风险或遗留项：
- 回滚方式与回滚验证：
- Git 提交/工作树状态：
- 下一任务：
```

## 10. 发布签字模板

P7 完成时必须追加最终签字记录：

```text
架构契约：通过/不通过
四策略等价：通过/不通过
ExecutionPlanV1：通过/不通过
声明式第五策略：通过/不通过
安全边界：通过/不通过
浅色/暗色与可访问性：通过/不通过
全仓测试：通过/不通过
生产构建：通过/不通过
Windows 安装包：通过/不通过
回滚演练：通过/不通过
遗留问题：
批准发布人：
批准日期：
```
