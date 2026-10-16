# Windows 客户端 EV 签名

用户于 2026-09-19 明确要求以后 Windows 打包主动签名。本仓库默认开启 EV 签名并在失败时中止，不允许退回未签名包。版本遵循用户当次明确要求；2026-10-16 本次重做保持 **0.1.175**，仅打包、不上传或发布生产更新。

## CLI 与凭证

- 用户于 2026-09-19 根据服务商建议要求使用 [EV Sign 官方 CLI](https://wiki.evsign.cn/cli)。正常打包默认通过 `scripts/evsign-cli.cjs` 调用官方 CLI，使用 `-sha256 -t digicert`，不追加旧签名；失败不会自动回退为完整文件上传 API。
- CLI 位于仓库外的 `~/.codex/tools/evsign/evsign-client.exe`。`node scripts/evsign-cli.cjs` 可提前准备，打包时也会自动准备。CI 有独立准备步骤；可通过 `HAOLO_EVSIGN_CLI_PATH` 指定同一已验证工具。
- 当前 CLI 为官方 Windows 1.0.1，工具本身发布者为 **Keroro Software Ltd**。`scripts/evsign-policy.json` 分别固定 CLI 的 SHA-256、工具证书指纹及 HaoLo 产物证书指纹。工具更新须先复核再更新 pin，不自动接受固定下载地址返回的新二进制。
- 本地许可证：`~/.codex/secrets/haolo-evsign-license.json`，格式为 `{"licenseKey":"许可证 UUID"}`，可含 `password`、`certificateId`。此文件在仓库之外，当前机器已限制文件权限。不要复制到源码、日志或产品资源。
- CI：仓库加密 Secret `HAOLO_EVSIGN_LICENSE_KEY`，只向非 PR 的打包步骤注入。也可通过 `HAOLO_EVSIGN_LICENSE_FILE` 指定本地凭证文件。
- 当前许可证实际证书发布者：**Keroro Software Ltd**；颁发者为 GlobalSign GCC R45 EV CodeSigning CA 2020；证书到期时间 2027-08-27 03:38:41 UTC；产物指纹为 `EC6346287B2F343CB7BFA4CF4CAB7DB02379A0AD`，固定在 `scripts/evsign-policy.json`。Windows 会显示这个证书发布者名称。
- 2026-10-16 服务商默认证书从NaisNet更换为Keroro，首次构建按旧指纹正确中止。用户明确确认“已确认更换为 Keroro，允许更新固定证书”后才更新产物pin；候选已复核受信Authenticode、EV策略、SHA256、DigiCert时间戳及PE正文一致。旧NaisNet指纹 `0742580B8EA12653FE3A1E906613268467BAD80A` 仅用于历史记录，不作为新产物允许列表。CLI工具自身的哈希与证书pin保持原值。
- 证书更换必须先核对受信链和发布者，再明确更新指纹；不要为通过校验自动接受不同证书。
- CLI 文档要求通过 `-key` 传许可证，由 Node 直接传给子进程，不经过 shell。禁止打印命令参数、原始 CLI 输出或包含完整命令的进程错误；失败信息先脱敏。CLI 工具和许可证都不打入客户端。

## 自动更新与证书轮换

- 用户于2026-10-16明确要求：客户端自动更新不绑定证书公司名称，以兼容服务商证书轮换；不要在更新流程新增发布者名称或证书指纹固定比较。
- 本次核查0.1.175：客户端使用自有 `checkAppUpdate` → `downloadAppUpdate` → Windows安装器启动链路，没有使用 `electron-updater`，也没有运行时发布者名称／指纹校验。下载入口要求HTTPS及支持的安装包后缀，全量／续传／差分下载依据服务端发布元数据校验大小和SHA256；成功后退出客户端并启动NSIS安装器。应用更新逻辑不调用构建签名策略，NSIS定制脚本也没有公司名比较。
- 构建时的固定证书校验用于确认服务商按已批准证书签署本次产物，与客户端自动更新独立。证书更换按上方确认记录更新构建pin；保留安装包签名、可信时间戳及下载完整性校验，不因证书轮换关闭这些检查。Windows系统自身的安装提示／信任处理由系统负责。
- 验证：更新检查、全量／断点续传／差分下载和安装器启动相关30/30测试通过；本次仅核查并记录既有行为，没有修改运行时或重打安装包。

## 构建顺序

1. 按用户指定版本或发行技能规则确定版本，检查生产地址、类型及运行内核，运行 `node scripts/evsign-cli.cjs` 准备已验证的 CLI。
2. 编译 native host 和前端资源。
3. `pnpm exec electron-builder --win --x64 --dir --publish never`：先写入图标、版本与 ASAR 完整性资源，再签主程序和自有 native host。
4. `pnpm exec electron-builder --win nsis --x64 --prepackaged release/win-unpacked --publish never`：打入已签名文件，签卸载程序，再签安装程序，最后生成 blockmap。
5. `pnpm run verify:win-signatures`：核对最终主程序、native host、安装包及已嵌入的卸载程序副本，保存 `release/ev-signatures-版本.json`。卸载程序在 NSIS 内部签名回调中接受相同校验，原样副本保存在 `release/ev-signing`。安装包签名前再次验证内部主程序与 native host，防止误用旧的未签名目录。
6. 验证包内资源和第三方签名，记录最终安装包 SHA-256，再复制到桌面“好咯最新安装包”。同版本重做时先备份旧包。

native host 的 `extraResources` 必须使用 `from: resources/bin` 配合 `filter: [haolo-chrome-native-host.exe]`。electron-builder 26.11.1 的单文件复制分支跳过签名 transformer；直接指定 EXE 为 `from` 会漏签。集成测试通过真实复制流程验证辅助程序触发签名、源文件不变且第三方文件不被处理。

`scripts/sign-windows.cjs` 接入 [electron-builder 26 自定义签名接口](https://www.electron.build/v26/docs/api/app-builder-lib.interface.windowssigntoolconfiguration/)。CLI 仅操作隔离目录中的同名副本，保留审核时的真实文件名：比较可执行内容（仅允许签名区域、PE 校验和及签名对齐改变），然后验证 Windows Authenticode、固定证书、EV 策略 OID `2.23.140.1.3`、实际文件 SHA-256 签名与时间戳，全部通过才替换原文件。失败保留原文件，未通过校验的候选文件仅留在构建目录供诊断，不可分发。

签名范围：`haolo_desktop.exe`、`haolo-chrome-native-host.exe`、版本化的 `-Setup.exe` 和 `-Setup.__uninstaller.exe`。OpenAI 内核等第三方文件保留原发布者签名。凭证缺失、证书不符、服务拒绝、网络中断或校验失败均中止，禁止关闭 `forceCodeSigning` 或启用 `signAndEditExecutable=false` 来出包。

## 服务商审核

EV Sign 按许可证审核可签文件。接入时 native host 曾返回 HTTP 400“此文件未审核，请联系管理员审核”；2026-09-19 用户确认服务商已开通，辅助程序复测签名成功。后续构建仍必须逐个验证，不把一次审核通过当成永久可签保证。必须由服务商批准对应真实文件；不要改名、伪造文件信息或关闭签名绕过审核。

主程序、安装程序、卸载程序及辅助程序均需获准。可提供 `resources/bin/haolo-chrome-native-host.exe` 等实际产物给服务商，审核完成后再执行正常构建。尚未完成所有签名校验前，不得把此前的未签名安装包称作签名版。

## 0.1.170 签名重建验收（2026-09-19）

- 四个自有 EXE 均通过固定证书、EV 策略、SHA-256、可信时间戳和 Windows Authenticode 验证；Windows SDK SignTool `/pa /all /v` 为 4/4 成功、零警告、零错误。
- 从最终安装包提取主程序、native host 和卸载程序，其 SHA-256 与已经验证的签名文件逐一相同；应用 ASAR 也与构建输入相同。
- 最终四个程序均使用 CLI 签名。安装包 `haolo_desktop-0.1.170-Setup.exe`：202629016 字节，SHA-256 `8eb241ce29422e6a3060ab84e5e5d0fcb23498655459898eb79f88f410fe564f`。
- 本地 CLI 构建证据：`release/build-0.1.170-20260919-ev-cli`；四项签名报告：`release/ev-signatures-0.1.170.json`。此前 API 验证产物保留于 `release/archive/0.1.170-ev-api-20260919`，最终交付 CLI 版。签名凭证不进入这些报告。
