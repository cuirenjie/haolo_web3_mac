# Binance 首次绑定 422 与空连接恢复修复

2026-10-24。状态：本地修改及测试完成，未提交、未打包、未发布，未修改生产账号或数据库。

## 修复行为

- 权限不符合只读要求时，Windows 与业务后端都提供明确提示：开启读取权限，关闭交易、提现和划转权限后重新绑定。简中、英文、繁中同步覆盖；旧后端仅返回 `READ_ONLY_KEY_REQUIRED` 时新版 Windows 也能显示提示。
- Windows 只把已有服务器密钥的连接视为云端已绑定。只有空连接时显示“账户绑定未完成”，提供“重新绑定”和“查看教程”，不再推断绑定设备的操作系统。
- 本次新建连接的密钥提交失败时，调用新增的 `DELETE /api/mobile/v1/account-connections/{id}/pending-binding`。后端校验账号归属，在账号事务锁和记录锁内确认没有已保存凭据／绑定时间，才撤销空连接。已成功绑定的连接保持原状。
- 清理失败或连接旧后端时保留原始绑定错误，不回退到无条件解绑。遗留空连接可重用；重新安装或换设备也能重用账号下的空连接，避免多占连接名额。
- 重新绑定优先选用已有有效密钥的连接，避免被更新的空连接遮挡。重新绑定校验失败保留旧密钥，不进行清理。
- 恢复入口复用现有邮箱验证码流程和明暗主题按钮样式。旧 IPC 状态仍携带 `remoteOnly=true` 且没有服务器密钥时也显示恢复入口。

## 修改范围

Windows：`src/main/main.mjs` 的共享绑定与状态函数、`src/main/youle-api-client.mjs` 的安全清理方法、`src/shared/binance-account-errors.mjs`、`src/renderer/binance-account-ui.ts`、`src/renderer/app-language.mjs`，以及相关测试和离线视觉检查脚本。

业务后端：规范仓库 `haolo_front_web3/youle_mas-dev/backend/app/mobile/api.py` 的错误转换和新增清理路由，以及单元／集成测试。无数据库迁移，不涉及策略 Worker。

两个仓库原有其他会话未提交改动保留；后续提交需要按差异块选择范围，尤其是 Windows 的 `main.mjs` 和 `youle-api-client.mjs`。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| Windows 绑定 API、失败恢复、重新绑定、页面回归 | 37 通过，0 失败，0 跳过 |
| 后端权限校验、共享凭据、原凭据保护、空连接清理 | 80 通过，0 失败 |
| 独立本机 PostgreSQL 生命周期／并发／Windows SDK 真实 HTTP | 14 通过，0 失败，0 跳过 |
| TypeScript 无输出类型检查 | 通过 |
| JavaScript 语法检查与 Git diff 空白检查 | 通过 |
| Electron 页面／权限弹窗，3 种语言 × 2 种主题 | 12 组合通过，无横向溢出，英文无中文残留；已抽查截图 |

合计 131 项自动化测试。集成测试使用临时 PostgreSQL 实例，仅监听 `127.0.0.1`，测试结束已停止；交易所调用均使用合成凭据和模拟响应，不接触真实 API 密钥。集成测试有两条既有 websockets 弃用提示，无失败。

扩展回归发现两个旧测试桩未接受现有 `fetch_snapshot(cache_scope=...)` 参数，已补齐参数兼容，未修改相关生产缓存逻辑。

## 复验入口

从 Windows 仓库根目录运行：

```powershell
node --experimental-transform-types --test youle_desktop/test/binance-account-incomplete-binding.test.mjs youle_desktop/test/binance-account-binding-api.test.mjs youle_desktop/test/binance-account-rebind.test.mjs youle_desktop/test/binance-account-recovery.test.mjs youle_desktop/test/binance-account-ui.test.mjs
node youle_desktop/scripts/typecheck.mjs
```

视觉脚本：`scripts/binance-binding-recovery-qa.mjs`，通过本地 Electron 执行；输出 `output/binance-binding-recovery-qa/results.json` 与 12 张截图，外部网络请求全部阻断。

后端测试：`tests/unit/test_binance_pending_binding.py`、`test_mobile_shared_credentials.py`、`test_binance_credential_recovery.py`、`test_mobile_binance_account.py`。使用后端虚拟环境、`PYTHONPATH` 指向规范后端目录，运行 `pytest --noconftest --asyncio-mode=auto`，避免加载与本任务无关的全应用测试启动项。

真实数据库测试：`tests/integration/test_binance_rebind.py`；`HAOLO_BINANCE_REBIND_TEST_DATABASE_URL` 必须指向本机隔离且以 `_test` 结尾的数据库，`HAOLO_WINDOWS_REPO` 指向规范 Windows 仓库。

## 尚未执行

未构建安装包、未部署 API、未修改生产遗留空记录。本次修复不会直接改变已安装旧客户端的行为，生产生效需要后续独立发布授权。
