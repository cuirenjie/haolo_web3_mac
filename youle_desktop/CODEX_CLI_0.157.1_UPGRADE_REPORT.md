# Codex CLI 0.157.1 升级兼容报告

日期：2026-09-27

## 结论

Haolo 桌面端捆绑的 Codex CLI 已从 `0.153.4` 升级到 OpenAI 官方稳定版 `0.157.1`。该版本包含 GPT-6 模型目录，`model/list` 返回 `gpt-6-astra`、`gpt-6-sol` 和 `gpt-6-luna`，并可创建 `gpt-6-astra` 会话。

网关要求的客户端版本头也同步更新为 `0.157.1`。已有用户配置中的 `0.144.1` 和 `0.153.4` 头会在下次启动时自动迁移，避免运行时和网关看到的版本不一致。

## 运行时资产

官方发布页：<https://github.com/openai/codex/releases/tag/rust-v0.157.1>

| 文件 | SHA-256 |
|---|---|
| `haolo_ai.exe` | `8cb0e69e99ff2a158c54815db82d0f2e524d8f301bc30184722cfd1ae5973574` |
| `codex-command-runner.exe` | `3834fec990e505577888605f11b3c9820d1384784b8709861ac7e61122aa2c1c` |
| `codex-windows-sandbox-setup.exe` | `c6a5ec12dee7f9563c5d0f2f6e8b82a0528e5cedd4d330dbda091dbb91d58b78` |

官方下载包 `codex-x86_64-pc-windows-msvc.exe.zip` 的 SHA-256 为 `9b0cbcd72bcbea43433d18b82a50c09a7065f6bd6c503a3d9606a539283b89bf`。

三个 Windows 运行时文件均通过 Authenticode 校验，签名主体为 `OpenAI OpCo, LLC`。版本和哈希记录在 `resources/bin/codex-runtime.json`，可运行以下命令复验：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-codex-runtime.ps1
```

## 验证结果

- `haolo_ai.exe --version`：`codex-cli 0.157.1`。
- App Server `/readyz`、WebSocket `initialize` 和基础 `thread/start`：通过。
- `model/list`：识别 GPT-6 Astra、Sol、Luna。
- 以 `gpt-6-astra` 创建临时线程：通过，返回 `cliVersion=0.157.1`。
- 运行时打包清单、签名和 SHA-256：通过。

## 注意事项

当前验证使用的是本地 App Server 和模型目录；生产网关真实请求仍需使用已有有效账户权限和凭据。客户端升级解决的是截图中明确的“需要更新版本 Codex”拒绝，不能替代网关账号或模型授权配置。
