# M1-318：历史策略卡片周期串用修复

用户复现：在同一会话进行 ETH 1H 策略分析，切换 4H 并完成新分析，再回看原卡片，旧卡片标题变为 4H。

## 根因

- `renderMessageExecutionPlan` 每次渲染读取 `tradingLastAnalysisLabelForThread`；该标签描述最近一次分析，不属于某条历史消息。
- `executionPlanCardTitle` 将卡片标题、最新分析标签、会话名和正文拼接；先寻找紧凑标签 `ETH4H`，会覆盖原始标题中的 `1H`。市场与周期还能分别来自不同来源。
- 计划页、创建计划、便利贴、预警同步、状态通知和持仓匹配也读取同一可变标签。持仓匹配的市场解析器另有跨来源优先匹配 `BINANCE:FUTURES` 的同类问题。
- 原始报告仍保存完整市场/周期标题；重新渲染会产生错误显示，不需要重算历史分析。

## 修复

1. 每个标题来源单独解析市场与周期，原始完整卡片标题优先；旧版通用标题可从该条报告正文恢复，不再拼接不同来源的市场和周期。
2. 消息渲染和“添加到计划”共用 `executionPlanCandidateWithSourceText`，将候选标题绑定原始报告，正文和价格不变。无法从原文确认市场时保留通用标题。
3. 计划、便利贴、预警及通知只读取候选或已保存计划的信息；新计划保存候选标题作为来源快照，不采集已变化的会话名称。持仓匹配优先采用该计划标题的市场。
4. 保留既有存储格式与三语/主题行为；无需新增状态、模型调用或后台网络请求。

## 验证

- 新增 `test/execution-plan-context.test.mjs`：初始 10 项在修复前全部失败；最终 11 项通过。直接执行生产 Renderer 函数，替换应用 I/O，覆盖 1H→4H→回看、跨市场、迟到/多市场报告、多空卡片、15M/1D/1W、中文/数字币种、USDC、三语与双主题、计划/便利贴/预警/通知、保存重载及真实 transcript marker 注入恢复。
- 执行计划、策略运行时、裸 K 分析、目标锁定与会话持久化等相关测试最终 **118/118**，无跳过。顺带更正通知测试的旧中文硬编码断言，改为当前既有 `mainUiText("planStatusUpdated")` 国际化调用；未改通知主进程实现。
- `scripts/execution-plan-context-visual-qa.cjs` 使用实际生产卡片渲染函数及 CSS，在隔离 Electron 39 窗口执行原生点击。明暗主题均验证 1H/4H 卡片同时存在、切 BTC 后标题保持、便利贴/计划预警原市场周期一致、键盘焦点及已添加禁用状态；Renderer 错误为 0，截图已检查。
- `pnpm run typecheck`、`pnpm run build`、QA 脚本语法检查及 `git diff --check` 通过。构建仅有既有大 chunk 提示。

本地证据：`.cache/execution-plan-context-before.log`、`.cache/execution-plan-regression.log`、`.cache/execution-plan-typecheck.log`、`.cache/execution-plan-build.log`、`.cache/execution-plan-context-qa/report.json` 与同目录 `light.png`/`dark.png`。

## 交付边界

本轮完成源码修复与隔离验证，未打包、安装、提交、推送或发布。未修改用户真实会话、已保存计划或线上预警。历史消息在修复版中会按原始报告重新渲染；旧版若已将错误周期保存到独立计划/预警，缺少原始依据时不会猜测或自动覆盖其持久化内容。
