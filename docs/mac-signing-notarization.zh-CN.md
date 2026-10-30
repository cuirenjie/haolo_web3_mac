# HaoLo Mac 签名证书、Universal 打包与官网公证分发

> 后续产品验收：2026-10-30 的 [Mac 0.1.183 正式签名包](../youle_desktop/docs/mac-release-0.1.183-20261030.zh-CN.md) 已完成 Developer ID 签名、Apple 公证、附票、正式门禁和桌面交付；未上传官网。下文“尚未”描述为 2026-10-29 证书任务的历史状态，实际凭据与发布结果以该次验收为准。

任务：`MAC-SIGNING-001`；记录日期：2026-10-29。适用仓库为 `cuirenjie/haolo_web3_mac`，应用目录为 `youle_desktop`，交付分支为 `origin/dev`。本文依据证书创建回执、Mac 源码 `8dc9f2ccf658b65126f21f0f0beffad456ed4d50`、本机工具帮助和文末官方文档整理。以后执行前须重新核对当前版本与配置。

**已完成的是组织证书创建、安装及独立程序签名自检；HaoLo Mac 产品尚未使用新证书打包、公证或官网发布。** 下文产品流程是以后执行的步骤，不是本次已完成的发布回执。本次只提交文档，不升版、不修改产品代码或签名门禁。

## 1. 当前已具备的签名材料

| 项目 | 2026-10-29 实际核验 |
| --- | --- |
| 组织 | Shenzhen Haoluo Technology Co., Ltd |
| Team ID | `78JM58SYA3` |
| 证书类型 | Developer ID Application，G2 Sub-CA |
| Apple 证书 ID | `8G49FU6D23` |
| 钥匙串身份 | `Developer ID Application: Shenzhen Haoluo Technology Co., Ltd (78JM58SYA3)` |
| SHA-1 选择器 | `B03399411A0BD8F2923434B35E264F542B8C51EC` |
| SHA-256 指纹 | `2af628e38ac0e3680c2abe11373bc87e0f44dff93e7e6d3be103485d8922db80` |
| 到期时间 | **2027-11-28 01:13:43 +08:00**，以实际证书为准，不套用其他证书年限 |
| 本机安装 | login 钥匙串；证书、独立 RSA 2048 私钥匹配，代码签名证书链验证成功 |
| 自检结果 | 独立 arm64 程序编译、Developer ID 签名、严格验签及运行退出码均为 0；包含 Hardened Runtime 和 Apple 安全时间戳 |
| 保留项 | 原 Apple Distribution／iOS 身份未吊销、未替换 |

组织名、Team、证书 ID 和指纹是核对标识，不包含证书文件或私钥内容。证书不是单个 Bundle ID 的替代品；Mac 应用仍须使用自身已确认的标识和权限。

本机材料在 **Git 仓库外**：`~/Library/Application Support/HaoLo/macos-signing/20261029/`。目录权限 0700，私钥及材料文件权限 0600。文件包括 `developer-id-application.cer`、`developer-id-application.key`、对应 `.certSigningRequest`、官方 G2 中间证书，以及 `issuance-result.json`、`completion-receipt.json`、`installation-commands.jsonl`、`signing-verification.jsonl`。这些文件均不提交。

私钥已导入钥匙串；上述 PEM 备份文件本身没有口令，靠本机目录／文件权限保护，不能称为加密备份。迁机前通过钥匙串导出带口令的 `.p12`，或使用经审查的加密备份方式；口令与文件分开保管。不要把私钥、`.p12`、`.p8`、证书或密码复制到仓库、聊天、构建日志、Renderer 或产品资源。仅有 `.cer` 不能在另一台电脑签名，还须匹配私钥。

## 2. 这次申请的实际经验

1. 先执行 `security find-identity -v -p codesigning`。本机原来只有 Apple Distribution，没有 Developer ID。通过现有 App Store Connect API 查询 Developer ID Application／G2，结果为 0；用原组织证书核对组织名称和 Team。
2. 在受保护的仓库外目录生成独立私钥及 CSR，验证 CSR 签名、公钥与私钥匹配。没有复用 iOS 私钥；仅 CSR 公钥申请上传 Apple，私钥留本机。
3. 现有 App Manager 上传 API 密钥可以查询、下载证书，但创建接口返回 **HTTP 403：This operation can only be performed by the Account Holder**。不要靠重复请求、提升上传 Key 权限或重建组织解决。失败回执 `creation-result.json` 保留，最终成功以 `issuance-result.json` 为准。
4. 用户明确允许本次仅操作 Apple 证书网页后，使用当前组织 Account Holder 会话，在 Certificates → Add → **Developer ID Application** 选择 **G2 Sub-CA**，上传同一 CSR，签发并下载。该次网页授权不扩大为自动操作移动 App 或其他网站的授权。
5. 下载后检查组织、Team、用途扩展、有效期及公私钥匹配，再导入 login 钥匙串。官方 G2 中间证书本机已存在，复用即可；`already in keychain` 不等于需要删除重装。不要给未知证书设置“始终信任”，不要关闭验证。
6. 独立零行为程序用 `codesign --options runtime --timestamp` 签名并严格验证，证明本机私钥能实际签名。它不是完整 Electron／Universal 包，不证明 Intel、插件、权限、Gatekeeper 离线安装或产品公证已通过。

Apple 官方要求 Account Holder 创建此类本地证书；证书用途与申请步骤见 [Developer ID certificates](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)。G2 来源为 [Apple PKI](https://www.apple.com/certificateauthority/)，不从第三方下载证书链。

## 3. 区分证书、认证和发行渠道

| 材料或结果 | 能做什么 | 不能代替什么 |
| --- | --- | --- |
| Apple Distribution | App Store Connect／商店渠道应用签名 | 官网 Mac 的 Developer ID 身份 |
| Developer ID Application | 官网分发的 `.app`、Mach-O 代码及 DMG 签名 | 公证结果、PKG 的 Installer 签名 |
| Developer ID Installer | 签名 PKG 安装器；当前未创建 | PKG 内应用本身的签名 |
| App Store Connect API Key／Apple 专用密码 | 向公证服务认证 | 用于 codesign 的证书和私钥；APNs Key 也不能替代它 |
| `notarytool` 返回 `Accepted` | 对该次上传内容的 Apple 公证通过 | 已附加票据、完整产品验收、官网已发布或 App Store 审核 |

直接分发公证使用 `notarytool`，不能照抄 iOS 的 `ios-release.py`、IPA 或 TestFlight 上传步骤。参考 [Apple 证书类型](https://developer.apple.com/help/account/certificates/certificates-overview/) 和 [公证入口](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)。

## 4. 本仓库的实际打包链路和发布前检查

当前产品是 **Electron**，不是移动仓库 Flutter 的 macOS target。`youle_desktop/package.json` 的已核对值：应用包 `haolo_desktop`、内部产品名 `haolo_desktop`、显示名“好咯”、Bundle ID **`local.haolo.desktop`**、版本 `0.1.182`、Electron `41.10.2`。继续保留 Mac 标识，不改成 iOS 的 `com.haolo.haoloMobile`。本机 Node `22.23.1`、pnpm `10.33.0`、已安装 electron-builder `26.11.1`；安装依赖遵守 `pnpm-lock.yaml`，不为了签名升级到 v27。

| 当前入口 | 实际作用与注意事项 |
| --- | --- |
| `verify:mac:runtimes` | 核验源运行时架构、摘要、官方来源／签名及伴随工具；不能用 LFS 指针代替二进制 |
| `prepare:mac -- --arch=x64,arm64` | 准备两套运行时、图标及平台资源 |
| `build` | 生成 Mac 客服知识快照，再构建 renderer |
| `pack:mac:*` | 命令里显式 `identity=-`、`hardenedRuntime=false`，是本地 ad-hoc 包；即使钥匙串新增证书也不会自动变正式包 |
| `dist:mac:universal`／`dist:mac` | 依次检查运行时、准备资源、构建、electron-builder DMG、`finalize:mac` |
| `finalize:mac -- --target=universal` | 正式分支要求 DMG 票据、Gatekeeper 和挂载内容一致；**不会替你提交 DMG 公证**，并会清理当前版本匹配的 ZIP／blockmap |
| `verify-mac-package.mjs` | 架构、版本、资源、源码边界、deep／strict 签名和 entitlement 检查 |
| `verify:mac:update-artifact` | 核对 DMG 与本次源 App 的版本、ASAR、双架构 CDHash；**本身不替代正式公证信任门禁** |

配置有主 App／继承 entitlement 文件、Hardened Runtime 和 `mac.binaries` 清单；当前没有 `afterSign`／DMG 公证自动化。electron-builder 的 App 自动公证也不等于最终 DMG 已公证。为了能在 finalize 前取得 DMG 并公证，首次正式发行采用下面的**分阶段命令**；保留最终验证，不使用 `HAOLO_ALLOW_UNTRUSTED_MAC_DMG=1` 通过正式门禁。

开始前核对 Git 根目录、origin、分支、SHA、工作区和远端。保留所有本地修改与未推送提交，只在可快进时同步；不同任务共用目录时用独立工作树，避免切换他人的分支。Mac 源码、版本批准、官网现有版本和历史失败产物全部核对后才冻结候选。本次文档提交不修改版本。

未来正式构建优先在**独立工作树和唯一输出目录**执行：以已审查 SHA 建立工作树，确保其 `youle_desktop/release` 没有旧产物。若必须在原工作区构建，先将原 release 全部移入仓库外带时间戳的归档并核对摘要，不能清空或覆盖；失败尝试同样保留。归档带上版本、架构、源 SHA、dirty 差异、工具版本、构建命令和起止时间。

## 5. 依赖、运行时与产品回归

以下为以后获准正式打包时的模板，逐段执行、检查退出码，不把整个文档一次粘贴执行。`HAOLO_MAC_REPO` 指当次实际构建工作树；`HAOLO_MAC_EVIDENCE` 是预先新建、仅本用户可访问的仓库外证据目录。

```bash
set -euo pipefail
: "${HAOLO_MAC_REPO:?设置已核验的 Mac 构建工作树绝对路径}"
: "${HAOLO_MAC_EVIDENCE:?设置本次唯一的仓库外证据目录}"
test -d "$HAOLO_MAC_REPO"
test -d "$HAOLO_MAC_EVIDENCE"
umask 077
cd "$HAOLO_MAC_REPO"
git status --short --branch
git rev-parse HEAD
sw_vers
xcode-select -p
xcodebuild -version
xcodebuild -checkFirstLaunchStatus
node --version
pnpm --version
pnpm install --frozen-lockfile
git lfs pull --include='youle_desktop/resources/bin/darwin-*/haolo_ai,youle_desktop/resources/bin/darwin-*/rg,youle_desktop/resources/bin/darwin-*/codex-code-mode-host,youle_desktop/resources/haolo-logo.icns'
pnpm --filter haolo_desktop run verify:mac:runtimes
pnpm --filter haolo_desktop run prepare:mac -- --arch=x64,arm64
pnpm --filter haolo_desktop typecheck
pnpm --filter haolo_desktop test
pnpm --filter haolo_desktop build
```

保持 Universal **arm64＋x64**，包括 Electron、Helper、`haolo_ai`、`rg`、`codex-code-mode-host` 与实际原生依赖。源运行时官方签名检查在打包前完成；之后应用副本由打包器组织签名，分别记录来源验证与最终包验证，不在源目录重签官方文件。缺失运行时、LFS 下载失败或资源审计失败先修复，不删门禁。

测试包括真实字体六语言／双主题、核心流程、弱网及原生集成。保存真实失败、平台跳过和证据；不得因证书自检成功声称产品回归通过。正式包中不得混入 Windows 专属程序、私有策略引擎、真实用户配置或凭据。源码证据见 [运行时检查器](../youle_desktop/scripts/verify-codex-runtime-macos.mjs)、[包审计](../youle_desktop/scripts/verify-mac-package.mjs) 和 [afterPack](../youle_desktop/scripts/after-pack-cloud.cjs)。

## 6. 显式选择 Developer ID，生成签名 Universal DMG

先重新运行 `security find-identity -v -p codesigning`，核对有效期及指纹。2026-10-28 的测试包曾因自动发现选中 Apple Distribution 而中止；不能只按组织名称选证书。当前 electron-builder 26.11.1 支持以身份 SHA-1 精确选择，且禁止在名称选项中带 `Developer ID Application:` 前缀；下例使用已核验的大写 SHA-1。轮换证书后替换选择器，不能继续抄旧值。

```bash
cd "$HAOLO_MAC_REPO/youle_desktop"
security find-identity -v -p codesigning
HAOLO_MAC_SIGNING_SHA1='B03399411A0BD8F2923434B35E264F542B8C51EC'
# 分阶段构建：此处尚未公证，禁止发布；公证与 finalize 在后面执行。
env -u ELECTRON_RUN_AS_NODE -u HAOLO_ALLOW_UNTRUSTED_MAC_DMG \
  CSC_IDENTITY_AUTO_DISCOVERY=false \
  pnpm exec electron-builder --mac dmg --universal --publish never \
  --config.mac.identity="$HAOLO_MAC_SIGNING_SHA1" \
  --config.forceCodeSigning=true --config.mac.type=distribution \
  --config.mac.hardenedRuntime=true --config.mac.notarize=false \
  --config.dmg.sign=false
HAOLO_MAC_VERSION="$(node -p 'require("./package.json").version')"
HAOLO_MAC_APP="$PWD/release/mac-universal/haolo_desktop.app"
HAOLO_MAC_DMG="$PWD/release/好咯-${HAOLO_MAC_VERSION}-universal.dmg"
test -d "$HAOLO_MAC_APP"
test -f "$HAOLO_MAC_DMG"
node scripts/verify-mac-package.mjs --target=universal
codesign --verify --deep --strict --all-architectures --verbose=4 "$HAOLO_MAC_APP"
codesign --display --verbose=4 --arch arm64 "$HAOLO_MAC_APP"
codesign --display --verbose=4 --arch x86_64 "$HAOLO_MAC_APP"
# 显式签署尚未签名的最终 DMG，并要求安全时间戳。
codesign --sign "$HAOLO_MAC_SIGNING_SHA1" --timestamp "$HAOLO_MAC_DMG"
codesign --verify --strict --verbose=4 "$HAOLO_MAC_DMG"
codesign --display --verbose=4 "$HAOLO_MAC_DMG"
```

`mac.notarize=false` 只让本阶段采用下节显式公证，而非绕过发行要求；`dmg.sign=false` 避免隐式容器签名，本段随后直接签署 DMG。若 App 或 DMG 输出仍是 ad-hoc、错误 Team／Authority、缺安全时间戳或 App 缺 runtime 标志，停止，不进入公证。还要逐个核对 Helper／可执行子组件的身份和权限，而非只看外层 App。

本项目现有主／继承 entitlement 都包含 JIT、unsigned-executable-memory 和麦克风权限；现有检查明确禁止开启 dyld-environment-variables、disable-library-validation。正式发布还须确认没有调试用 `get-task-allow=true`，权限确为当前 Electron／原生依赖所需。需要受限能力时另核对对应 Developer ID profile，不复用 iOS profile。不要为通过公证随意放宽 entitlement 或移除运行时必需权限。

让已锁定的打包器按组件由内向外签名；必要的签名修复应落到审查过的配置／脚本后重建。**不使用 `codesign --deep --sign` 一次覆盖全部组件**，`--deep` 仅在上述验证中使用；库与主程序不能盲目套用同一权限。参考 [Apple 签名顺序及权限](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac/)；electron-builder 配置以 [v26 文档](https://www.electron.build/v26/docs/mac/) 和锁定源码为准，v27 已改变字段结构。

## 7. 公证认证：先验证，再保存到钥匙串

公证与签名是两套凭据。优先复用有权限的当前组织 API Key，使用 `notarytool store-credentials` 的默认验证；如果权限不足，按实际错误处理，不将证书创建时的 Account Holder 限制泛化为所有公证请求都需持有者。

下面的 profile 名仅为建议，**本次尚未创建或验证公证 profile**。选择一种认证方式；不要同时提交两套参数。团队 API Key 需要 Issuer ID，个人 API Key 不提供 Issuer ID。路径、ID 从本机安全记录读取，不把 `.p8` 内容放环境变量或日志。

```bash
: "${HAOLO_NOTARY_API_KEY_FILE:?仓库外团队 API p8 的绝对路径}"
: "${HAOLO_NOTARY_API_KEY_ID:?团队 API Key ID}"
: "${HAOLO_NOTARY_ISSUER_ID:?团队 Issuer ID}"
xcrun notarytool store-credentials 'HaoLo-mac-notary' \
  --key "$HAOLO_NOTARY_API_KEY_FILE" \
  --key-id "$HAOLO_NOTARY_API_KEY_ID" --issuer "$HAOLO_NOTARY_ISSUER_ID"
```

另一条路线是 Apple 账号＋专用密码：由用户在 Apple 官方账号页面生成专用密码，在本机安全提示里输入，不使用账号登录密码、不写入 `--password` 参数或 shell 历史：

```bash
: "${HAOLO_NOTARY_APPLE_ID:?在本机指定有权限的 Apple 账号}"
xcrun notarytool store-credentials 'HaoLo-mac-notary' \
  --apple-id "$HAOLO_NOTARY_APPLE_ID" --team-id '78JM58SYA3'
```

保持默认验证，不使用 `--no-validate` 掩盖认证错误。本机 profile 默认不加 `--sync`；CI 使用独立秘密存储和临时钥匙串，不能提交本机钥匙串、P12 口令或 API Key。当前 Mac Actions 仍是显式无正式签名的验证流程，不能把本机创建证书记成 CI 已接通正式发行。

## 8. 提交最终 DMG，处理状态与失败

本仓库当前主交付格式为 DMG。先记录**上传前** DMG 的 SHA-256，提交已签名的最终容器；不在等待公证期间继续修改 App、ASAR、资源或 DMG。

```bash
shasum -a 256 "$HAOLO_MAC_DMG" > "$HAOLO_MAC_EVIDENCE/dmg-before-notary.sha256"
xcrun notarytool submit "$HAOLO_MAC_DMG" \
  --keychain-profile 'HaoLo-mac-notary' --no-wait --output-format json \
  > "$HAOLO_MAC_EVIDENCE/notary-submit.json"
HAOLO_NOTARY_SUBMISSION_ID="$(python3 -c \
  'import json,sys,uuid; print(uuid.UUID(json.load(open(sys.argv[1]))["id"]))' \
  "$HAOLO_MAC_EVIDENCE/notary-submit.json")"
```

保存 ID 后对同一次提交查询／等待。下面单次有界等待可能超时；超时只表示客户端停止等待，Apple 仍可能处理，不立即重新上传。每次查询另存带时间戳回执，保留真实退出码。只有明确 `Accepted` 才进入下一节。

```bash
HAOLO_NOTARY_CHECK_TIME="$(date -u +%Y%m%dT%H%M%SZ)"
if xcrun notarytool wait "$HAOLO_NOTARY_SUBMISSION_ID" \
  --keychain-profile 'HaoLo-mac-notary' --timeout 60s \
  > "$HAOLO_MAC_EVIDENCE/notary-wait-${HAOLO_NOTARY_CHECK_TIME}.txt" 2>&1; then
  HAOLO_NOTARY_WAIT_EXIT=0
else
  HAOLO_NOTARY_WAIT_EXIT=$?
fi
printf '%s\n' "$HAOLO_NOTARY_WAIT_EXIT" \
  > "$HAOLO_MAC_EVIDENCE/notary-wait-${HAOLO_NOTARY_CHECK_TIME}.exit"
HAOLO_NOTARY_INFO="$HAOLO_MAC_EVIDENCE/notary-info-${HAOLO_NOTARY_CHECK_TIME}.json"
xcrun notarytool info "$HAOLO_NOTARY_SUBMISSION_ID" \
  --keychain-profile 'HaoLo-mac-notary' --output-format json > "$HAOLO_NOTARY_INFO"
HAOLO_NOTARY_STATUS="$(python3 -c \
  'import json,sys; print(json.load(open(sys.argv[1]))["status"])' "$HAOLO_NOTARY_INFO")"
# 终态后保存日志，Invalid 的错误和 Accepted 的警告都要阅读。
case "$HAOLO_NOTARY_STATUS" in
  Accepted|Invalid)
    xcrun notarytool log "$HAOLO_NOTARY_SUBMISSION_ID" \
      --keychain-profile 'HaoLo-mac-notary' \
      "$HAOLO_MAC_EVIDENCE/notary-log-${HAOLO_NOTARY_CHECK_TIME}.json"
    ;;
esac
# 失败或仍在处理时停止本段；排查或查询同一 ID，不能继续 staple。
test "$HAOLO_NOTARY_STATUS" = 'Accepted'
```

若 submit 断网而结果不明，先用 `notarytool history --keychain-profile 'HaoLo-mac-notary'` 及已保存 ID 核对，不能盲目重试制造多个请求。`Invalid` 时逐项按日志的文件、架构和问题修复，重新构建／签名为新的候选，保留失败包和回执。首次团队处理可能更久，不能承诺完成时限。S3 加速连接失败时可在核实网络后按 CLI 使用 `--no-s3-acceleration`；不关闭 TLS、不使用 `--force` 跳过预检，也不把上传成功当成公证通过。参考 [Apple 自定义公证流程](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow) 和 [常见问题](https://developer.apple.com/documentation/security/resolving-common-notarization-issues)。

## 9. 附加票据、包审计与 Gatekeeper

仅对上一节明确 Accepted 的同一份 DMG 执行：

```bash
xcrun stapler staple "$HAOLO_MAC_DMG"
xcrun stapler validate "$HAOLO_MAC_DMG"
codesign --verify --strict --verbose=4 "$HAOLO_MAC_DMG"
spctl --assess --type open --context context:primary-signature --verbose=4 "$HAOLO_MAC_DMG"
cd "$HAOLO_MAC_REPO/youle_desktop"
env -u HAOLO_ALLOW_UNTRUSTED_MAC_DMG pnpm run finalize:mac -- --target=universal
pnpm run verify:mac:update-artifact -- \
  --artifact "$HAOLO_MAC_DMG" --arch universal --declared-arch universal
syspolicy_check distribution "$HAOLO_MAC_APP"
shasum -a 256 "$HAOLO_MAC_DMG" > "$HAOLO_MAC_EVIDENCE/dmg-final.sha256"
```

`finalize:mac` 会验证票据／Gatekeeper、只读挂载 DMG、验证包内 App，并与当前构建的 App 比对版本、ASAR、双架构 CDHash，然后卸载。正式模式不会替已签名 DMG 重建内容；不要在它运行前把产物改名到不符合当前版本／架构命名规则，导致“没有找到 DMG”而误判通过。保留源 App 供比较。需要保留的同版本 ZIP／blockmap 先归档，再运行会清理它们的 finalize。

`syspolicy_check` 适用于当前 macOS；旧目标系统仍须在对应系统实际验收。`codesign` 通过只说明签名结构，不等于系统发行评估通过。当前项目脚本还会运行 `spctl`，如新版系统弃用相关检查，需依据实际错误和官方说明修复检查器，不能删除门禁。参考 [Apple TN3161](https://developer.apple.com/documentation/technotes/tn3161-inside-code-signing-certificates)。

附加票据会改变容器字节，因此上传前摘要和**最终交付摘要**分别保存。在最终 Gatekeeper 检查后不再改动产物；任何应用内容变动都应重新签名、公证。不要通过移除 quarantine、关闭 Gatekeeper／SIP 或“强行打开”来宣称通过。

## 10. ZIP、PKG 与嵌套容器的区别

当前更新包校验器只接受 DMG，下列是未来变更分发格式时的处理规则，不代表本次新增了 ZIP／PKG 发布能力。

- **ZIP**：不能签名 ZIP 本身，也不能直接 staple ZIP。将已签名 App 用 `ditto -c -k --keepParent` 压缩提交；Accepted 后对原 App 执行 `stapler staple` 和 `validate`，再生成包含已附加票据 App 的新 ZIP，另存最终摘要；解压后的 App 再做严格验签、票据和系统评估。不要发布附票前的旧 ZIP。
- **DMG**：签名 App 和最终 DMG，只公证最外层最终容器并 staple DMG。本项目以此为主流程；无需把同一 App 和其 DMG 都重复提交。若之后要单独分发其中 App／ZIP，应单独核对该分发形式的票据携带情况，不能只搬用外层 DMG 的验证结论。
- **PKG**：需要另行获准创建／复用 Developer ID Installer。先签名其应用负载，再以 Installer 身份生成签名的 flat PKG，使用 `pkgutil --check-signature` 验证；公证并 staple PKG，独立测试安装／升级／卸载行为。Application 证书不能替代 Installer 证书。
- **多层容器**：按从内到外签名，通常提交最外层分发容器，staple 最终交付文件。第三方自定义／联网安装器还有负载与安装器分别公证的要求，不能套用简单拖拽 DMG 流程。

上述格式规则以 [Apple 打包说明](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution) 为依据。不要对已完成公证的 App 再打补丁后只沿用旧票据。

## 11. 客服快照、真实验收与官网交付

`build` 会生成 `youle_desktop/release/support-bundle.json`，Vite／afterPack 检查源码、版本和 ASAR 中的合同。发布时保留同次生成的知识包，使用 **`macos`／`cuirenjie/haolo_web3_mac`** 身份；不采用移动或 Windows 合同。再独立比较 Python 和 Node 候选（在仓库根目录）：

```bash
cd "$HAOLO_MAC_REPO"
python3 tools/support_knowledge.py --check --output "$HAOLO_MAC_EVIDENCE/support-python.json"
node tools/prepare-support.mjs --check --output "$HAOLO_MAC_EVIDENCE/support-node.json"
python3 -c 'import json,sys; assert json.load(open(sys.argv[1])) == json.load(open(sys.argv[2]))' \
  "$HAOLO_MAC_EVIDENCE/support-python.json" "$HAOLO_MAC_EVIDENCE/support-node.json"
```

最终交付前检查知识包 source SHA、版本、contract_id、源文件摘要与同次产品构建一致。生成候选不代表生产登记或激活；服务端尚未识别 Mac 合同时保持文字客服并按门禁关闭代操作，不能冒称客服全功能接通。

手动验收必须使用**最终下载包**，优先在干净目标 Mac／隔离测试环境完成：浏览器下载保留 quarantine，离线打开已附票 DMG、拖拽安装、首次启动、旧版保留数据升级；Apple Silicon 与独立 Intel 分别检查。Rosetta x64 成功单列，不代替 Intel 真机。再核对内置 CLI、原生依赖、麦克风授权、六语言／双主题、账号安全存储及网络恢复。自动化只在授权范围内做 CLI 检查，不接管用户登录或覆盖已有安装／用户数据。

归档最终 App、DMG、SHA-256、源码 SHA／dirty 状态、锁文件／构建输入摘要、版本、架构、最低系统、工具版本、签名身份／有效期／权限、Notary submission ID／终态日志、票据与系统评估、support-bundle 和人工验收结果。旧包与失败候选不覆盖；包内不得包含上述秘密材料。

**官网上传／更新渠道启用需另有明确授权。** 按 Mac 现有发布合同发送实际版本、Universal 架构、最终摘要及同次知识包；回读下载链接并重新验签／比对摘要后才可记为交付。更新元数据、CDN、自动更新签名与回滚须按实际产品链路核对，不能把本地签名成功当成线上更新生效。公证不是 App Store 审核，本流程不提交商店审核，也不自动触发 iOS／Android 发布。

## 12. 本次文档交接与剩余事项

- 已验证：组织与新证书、本机钥匙串配对、官方链、独立程序签名／安全时间戳／运行。创建时 API 的 403 已通过 Account Holder 网页签发解决，无需再次建证书。
- 本轮文档已核对：原仓库实际 scripts／配置、electron-builder 26.11.1 身份选择与 notarize 逻辑、Notary／Stapler／syspolicy CLI 参数、当前签名身份及证据。产品命令为首次正式发布的待执行流程，没有借用以前 ad-hoc 测试结果冒充正式验收。
- 文档验证：8 段 Bash 示例通过语法检查，7 个仓库内链接有效；差异空白检查及本次两份 Markdown 的敏感内容审查通过。Python／Node 客服候选检查退出码均为 0，输出一致，仅保存仓库外本地候选；未执行产品构建、公证或上传。
- 待正式打包任务完成：确认发布版本／候选 SHA；验证公证认证；完整产品回归和 Universal 签名构建；最终 DMG 公证／附票／Gatekeeper／干净机器验收；获授权后再上传官网和启用更新。当前旧版 `0.1.182` 测试包仍为 ad-hoc／未公证，不能追改其历史记录。
- 仅提交本文和文档入口；不复制证书、CSR、密钥、profile、钥匙串、真实配置或本机大日志。工作区中其他任务教程文件独立保留。

历史对照：[2026-10-28 Universal 测试包](../youle_desktop/docs/mac-test-package-0.1.182-20261028.zh-CN.md)、[当前包配置](../youle_desktop/package.json)、[最终 DMG 检查](../youle_desktop/scripts/finalize-mac-dmg.mjs)、[正式信任门禁](../youle_desktop/scripts/mac-release-trust.mjs)。
