# Haolo GitHub 用户身份授权配置

## 目标链路

```text
Haolo 用户登录
  → 设置 → GitHub → 连接 GitHub
  → GitHub App 用户授权
  → Haolo 后端按用户 UUID 加密保存并自动刷新令牌
  → 全局 GitHub MCP / 内置 GitHub Skill
  → 操作归属于该 GitHub 用户
```

桌面端、Renderer、Codex 配置和 MCP 环境变量都不会接收 GitHub 用户令牌。

## 1. 修改 GitHub App

在 GitHub App 设置页完成以下配置：

- 如果所有 Haolo 用户都需要安装，`Where can this GitHub App be installed?` 选择公开安装。
- `Callback URL` 填写后端公开地址，例如
  `https://haolo.com/api/github/oauth/callback`。它必须与后端环境变量完全一致。
- 不启用安装时自动 OAuth；Haolo 会用一次性 `state` 主动发起用户绑定流程。
- 保持 user-to-server token expiration 启用。访问令牌默认约 8 小时，Haolo
  后端会使用轮换后的 refresh token 自动刷新。
- Repository permissions：`Contents: Read and write`、`Issues: Read and write`、
  `Pull requests: Read and write`、`Metadata: Read-only`。
- 不授予仓库管理、删除、工作流、Actions 或其他当前工具未使用的权限。

保存以下信息：

- `Client ID`：不是 App ID。
- 新建的 `Client secret`。
- App URL 中的 slug，例如 `haolo-github`。

用户身份模式不需要固定 `Installation ID` 或 GitHub App 私钥；这些只用于旧的
管理员 Bot/自动化兼容模式。

GitHub 官方说明：

- [生成 GitHub App 用户访问令牌](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- [刷新用户访问令牌](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens)
- [选择 GitHub App 权限](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)

## 2. 生成后端加密密钥

在 PowerShell 运行，输出只写入服务器密钥配置，不提交 Git：

```powershell
$githubKey = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($githubKey)
[Convert]::ToBase64String($githubKey)
```

该密钥用于 AES-256-GCM 加密每位用户的 GitHub access token 和 refresh token。
必须纳入生产密钥备份；丢失后已有用户需要重新授权。

## 3. 配置 AgentMS 后端

编辑实际部署生效的 `.env` 或密钥管理配置：

```env
GITHUB_ENABLED=true
GITHUB_USER_AUTH_ENABLED=true
GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxxxxxx
GITHUB_CLIENT_SECRET=不要提交到Git
GITHUB_OAUTH_CALLBACK_URL=https://haolo.com/api/github/oauth/callback
GITHUB_OAUTH_ENCRYPTION_KEY=上一步生成的Base64
GITHUB_APP_SLUG=haolo-github

GITHUB_PUBLIC_READ_ENABLED=true
GITHUB_WRITE_ENABLED=true

# 留空：每位用户可访问自己安装 App 时选择的仓库。
# 非空：作为管理员全局仓库上限，逗号分隔。
GITHUB_ALLOWED_REPOSITORIES=

# 留空表示全部 Haolo 用户；灰度时填 Haolo 用户 UUID，逗号分隔。
GITHUB_AUTHORIZED_USER_IDS=
GITHUB_WRITE_USER_IDS=

# 用户身份模式保持为空，避免退回共享 Bot 身份。
GITHUB_TOKEN=
GITHUB_APP_INSTALLATION_ID=
GITHUB_APP_PRIVATE_KEY_PATH=
GITHUB_APP_PRIVATE_KEY_BASE64=
```

部署时应用 Alembic `0054` 数据库迁移，然后重建或重启 `backend-api`。后端服务器
必须能访问 `github.com` 和 `api.github.com`；国内桌面客户端只需要访问 Haolo 后端。

## 4. 用户操作

1. 打开 Haolo **设置 → GitHub**。
2. 点击“连接 GitHub”，在 GitHub 官方页面确认授权。
3. 返回 Haolo，等待状态变为“已连接”。
4. 点击“授权仓库”，把 Haolo GitHub App 安装到个人账号或组织，并选择仓库。
5. 之后无论是否显式使用 GitHub Skill，全局 GitHub MCP 都以该用户身份调用。

组织仓库仍受组织所有者、SAML SSO 和 GitHub App 安装策略约束。用户只能访问
“本人有权限”与“App 已安装授权”两者的交集。

## 5. 验证

先进行只读验证：

```text
不要使用 GitHub Skill，直接调用 github_status，告诉我当前 GitHub actor。
列出我的 GitHub 仓库。
读取 owner/repo 的 README。
```

再用测试仓库验证写入：创建新分支和草稿 Pull Request。每次写入仍需要明确确认；
GitHub 的提交、Issue、评论和 Pull Request 会记录连接用户为 actor，而不是共享 Bot。
