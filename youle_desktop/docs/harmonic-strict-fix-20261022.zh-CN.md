# 严格谐波与单价卡片修复验收

任务：M1-139-STRICT-20261022。关联历史排查：[harmonic-plan-audit-20261022.zh-CN.md](harmonic-plan-audit-20261022.zh-CN.md)。

用户明确要求修复形态失效、Shark 比例、图形与计划不一致，并追加要求：计划卡片只显示一个入场价，做多取区间最低价，做空取最高价。以下为本地源码与隔离测试结果，不是生产验收。

## 修复行为

- 七类形态的前置腿不得跳过更极端的点；发展中末腿反向越过旧 C/B 或穿过合法 PRZ 远端时，旧候选不再有效。已完成候选在后续 K 线影线触及止损后失效，不因收盘收回重新启用。
- Shark 使用 `BC/0B = 0.886–1.13`、`BC/AB = 1.618–2.24` 的交集；`AB/XA = 1.13–1.618`。测量标注、发展中投影、完成校验与止损硬边界使用同一基准，ATR 不扩大完成区。
- 只有已完成、仍有效且目标尚未到达的同一绘图候选可以产生条件计划。绑定候选 ID、快照、方向、PRZ、终点与原生价位；后端模型筛选和卡片投影分别再次校验。
- 发展中、无有效候选或模型选择等待时保留等待，谐波禁止完整区间兜底、左右侧兜底及保留候选兜底。
- 保留原生触发、结构止损和双目标。谐波不再迁移到现价、不套用通用 1% 止损、不改成三档风险倍数目标。费用、账户、个人硬约束和每档最低净盈亏比不满足时拒绝，不能改价凑条件。
- 新的区间计划统一使用做多下沿、做空上沿作为入场测算价，左右侧一致。后端风险/仓位和聊天、已保存计划、便利贴的价格栏一致。触发区域保留在条件合同中；历史回执不重算，旧口径与显示价不符时不展示不匹配的仓位及盈亏估计，提示重新分析。
- Windows 和后端内置谐波引擎均为 v4.0.0，Shark 子引擎 v2.0.0，策略清单 v3.0.0。共享构建器保留后端专有的时间和仓位钩子，来源清单按实际文件哈希更新。

## 验证

| 检查 | 结果 |
|---|---|
| Windows 谐波、通用计划和卡片专项 | 167/167 通过 |
| 新增后端真实引擎 → 模型选择 → 风控 → 绘图/卡片投影 | 28/28 通过；多空、左右侧、简中/繁中/英文 |
| 独立 Windows 对照回放 | 12/12 通过；保留旧 G1 基线，仅新增严格谐波后继回执 |
| 真实后端计划进入现有聊天、保存、便利贴渲染器 | 12 组通过；24 个三语言/双主题离屏页面无横向溢出，已目视核对多空单价与双目标 |
| TypeScript 与隔离 Vite 构建 | 通过；构建仅输出 `.cache`，无安装包或用户开发版重启 |
| Windows 全量 | 5033 项：5027 通过、6 项其他模块失败，详见下文 |
| 后端 Node 全量 | 1086 项：1042 通过、44 项其他模块失败，修改前共享构建器隔离复核同样失败 |
| 后端 Python 相关策略/计划回归 | 513 项：512 通过、1 项既有 `auto_left` 断言失败；使用修复前代码已复现 |
| 后端全部 Python 单元测试尝试 | 收集阶段有 113 个错误，缺少 fakeredis、botocore、slowapi 等非本任务依赖，未声称全后端通过 |

Windows 全量失败涉及 `app-language-no-han`（账户收益“今日”新词条）、`app-update-checks`、`binance-account-recovery` 两项、`font-size-setting`、`trading-favorites-api`。这些文件在其他工作中发生变化；本任务未修改其实现，未为获得绿灯覆盖其他工作。

后端 Node 44 项为图表形态候选方向 2 项、指数输出 6 项，以及 chart-patterns/wyckoff/order-flow 历史 G1 哈希 36 项。隔离副本将共享构建器恢复为修复前 HEAD，在同一组 45 个检查中仍为 44 失败、1 通过，证明不是严格谐波分支造成。后端 `test_left_theory_risk[auto_left]` 在修复前 `entry_policy.py` 中同样失败：当前代码将历史 auto 恢复为 right，旧测试期待自动回退 left。

## 可复查证据

- Windows 根目录：`.cache/harmonic-strict-20261022/targeted.log`、`windows-full.log`、`typecheck.log`、`build.log`、`render-fixture.json`、`render-results.json`、`card-*.png`。
- 后端根目录：`.cache/harmonic-strict-python-regression.log`、`harmonic-single-price.log`、`harmonic-strict-node-full.log`、`harmonic-strict-g1.log`、`harmonic-prechange-node.log`、`harmonic-prechange-policy.log`、`harmonic-strict-python-full.log`。
- 新的独立 Windows 基线：后端 `app/mobile/engine/fixtures/windows-g1-harmonic-strict-20261022.json`；包含源工作树状态、源码哈希、12 组输入与结果哈希，生成时逐组对比独立 Windows 和后端结果。
- 用户两张截图未提供原始冻结 K 线/runId，因此本轮使用受控 OHLC 正反例和原生引擎回放，不冒称已重放截图原任务或证明实盘收益。

未提交、推送、部署 API/Worker、制作安装包或修改用户已保存计划。生产任务是否生效需在授权发布后分别核对 API、策略 Worker 和客户端版本。
