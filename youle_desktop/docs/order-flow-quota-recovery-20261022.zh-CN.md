# M1-440：订单流数秒内失败修复

2026-10-22，根因修复与后端发布验收已完成。用户授权后，先等待其他会话的 9636253 发布退役并核实尚未包含本修复，再将已推送的 `6c0ac09d4ca95d14ec535efaec1f6a1a352b6192` 串行发布到 API 与独立策略 Worker。Windows 三语提示保留在本地工作区，未发布客户端安装包。

成交数据的共享额度需要等待约 25～33 秒，但后端把 HTTP 429 当作可选数据读取失败，返回空成交，再以 `ORDER_FLOW_DATA_UNAVAILABLE` 终止。仍保留的 13:58／13:59 失败任务在订单流结构阶段约 0.17 秒即失败，尚未模型复核；现场独立探测能取得 1000 笔真实成交及双边 100 档。

后端现在保留必需数据的额度冷却，在原任务中有界等待并重新采集整组证据，期间检查取消、授权和租约。65 秒恢复窗口内最多重采两次，超限明确返回 `ORDER_FLOW_DATA_RATE_LIMITED`。没有放宽额度、降低真实数据要求或改用 K 线伪造订单流；不更改模型预算及复核规则。

Windows `cloud-error.mjs` 与 `failure.mjs` 新增额度耗尽的简体、英文、繁体提示及诊断分类。本次不修改界面布局／配色，因此亮暗主题沿用原状态。新增独立 `order-flow-quota-error.test.mjs`，保留 `failure.mjs` 中 M1-438 的并行改动。

后端 Python 55、订单流引擎 6、Windows 云端运行与错误 54，共 115 项通过；发布前补充准入和控制器回归后 Python 为 86 项。先在旧代码得到 6 个复现失败，再验证恢复、取消、次数／等待上限、可选缺失、真缺数据、重新采样和单次冻结。Ruff、Node 语法和差异空白检查通过；两端实际镜像内各通过 18 项额度恢复、102 项完整计划及既有准入／禁用行情回归。

真实 BTCUSDT 永续 1H 任务 `0d80b94e-7f32-40ca-a33c-a19a7609e2ab` 在服务端用时 90.86 秒完成（本机轮询约 92 秒）：冻结 1000 笔成交、双边各 100 档、30 个 OI 点，实际模型复核成功，返回 722 字报告与条件计划卡。真实 `validateCloudResult` 和报告呈现合同校验通过，计划为未保存的 draft，未激活或下单。此为后端与桌面合同验收，未冒称客户端实窗点击验收。

根因修复位于规范业务仓库 `D:/haolo_front_web3/youle_mas-dev/backend/app/mobile/order_flow.py`。完整现场时间、基线及哈希见 [后端报告](D:/haolo_front_web3/youle_mas-dev/backend/docs/order-flow-quota-recovery-20261022.md)，双端终态、备份、镜像与真实分析证据见 [发布记录](D:/haolo_front_web3/youle_mas-dev/backend/docs/order-flow-quota-recovery-release-20261022.md)。当前 0.1.179 客户端可接收修复后的正常结果，新额度耗尽提示需后续客户端更新。
