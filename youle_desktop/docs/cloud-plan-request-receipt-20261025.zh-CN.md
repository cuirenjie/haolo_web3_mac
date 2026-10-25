# M1-443：已保存计划回执兼容修复

## 根因与现场证据

2026-10-25 20:41:56 起，本机 `app-server.log` 的 `cloud-plan-sync` 多次记录 `ERR_INVALID_ARG_TYPE`，调用栈为 `Hash.update → validateCloudEntryResult → validateCloudResult → createCloudPlans.list`。

M1-464 在新分析验收中增加了 `requestRequirements.promptHash` 与原始请求 `prompt` 的比对。计划列表同样调用这条验收路径，但后端 `windows_result.py` 的 `desktopReceipt` 只保留公开结果和身份上下文，不保留原始 prompt；它需要在原任务／会话清理后继续存在。`JSON.stringify(undefined)` 进入 Hash.update 导致整批读取中断。

只读核对当前账号 33 条已保存计划，1 条含新请求约束、33 条回执均不含 prompt。修复前原样回放重现同一异常，仅在内存补回原始 prompt 后 33/33 成功。服务器上的截图对应计划仍为 saved、pending 且有关联提醒，没有数据丢失证据。

## 修复边界

- `validateCloudResult` 仍用于新分析和分析恢复，严格核对原始 prompt；缺少或错误类型统一产生 `CLOUD_RESULT_CONTEXT_INVALID`，不再进入 crypto 触发类型异常。
- `validateSavedCloudResult` 仅由通过账号绑定的云端计划列表调用。它校验已保存且未删除、run/plan 身份、执行协议、上下文、冻结计划和偏好一致性，然后执行原结果、请求约束、条件哈希、绘图引用等校验。
- 历史回执不要求已经过期的原始 prompt。若兼容回退读取的是包含 prompt 的完整 run，继续核对该 prompt 的哈希。不会删除请求约束、填入空 prompt、跳过整条坏数据或重新计算计划。
- 所有计划通过后才整体合并并写入本机缓存。真正不一致的数据仍拒绝；缓存与静默网络重试、账号代际隔离保持原有语义。
- 数据校验失败使用简体、英文、繁体和韩文明确说明，保留本机计划，不再错误提示稍后重试。

## 验证

- 新增 `cloud-plan-request-receipt.test.mjs`，25 项覆盖三语多空历史回执、旧格式、完整 run 回退、新分析严格性、篡改拒绝、混合分页、来源映射、主进程响应到 Renderer 缓存，以及四语错误保留行为。核心历史读取用例已在旧实现复现 `ERR_INVALID_ARG_TYPE`。
- 8 个相关测试文件 173/173 通过；TypeScript 检查通过。
- 隔离 Vite 构建通过（20.79 秒），输出 `.cache/cloud-plan-receipt-build/renderer/`；只有既有大块体积提醒。
- 20:53:19 使用当前生产原始回执只读回放，未经字段补写，33/33 校验、33/33 Renderer 合并成功（pending 1、ended 32），无回退 run 请求或生产写入。脱敏结果位于 `.cache/cloud-plan-receipt-live-verification.json`。
- 后端 API 与独立 Worker 的已安装 `windows_result.py` 均确认采用不含 prompt 的原有回执格式。本次修复兼容该格式，无需后端改码、数据库迁移或生产部署。

- 20:56:09 通过应用内“立即重启”入口加载修复。20:58:45 现场打开计划页确认待执行 1、执行中 0、已结束 32，截图对应 BTC 计划完整呈现；20:59:22 复核加载修复后的日志同步异常为 0，最后一次旧异常为 20:52:35。共享目录其他会话更新导致后续开发版再次启动，实际窗口与进程均重新定位核验。

本次源码未提交／推送，未制作或发布 Windows 安装包；其他会话工作区改动保留。当前本机开发版已生效；其他机器及正式安装包不会因本次本地修复自动更新。
