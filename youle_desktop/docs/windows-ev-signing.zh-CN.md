# Windows 客户端 EV 签名

用户于 2026-09-19 明确要求以后 Windows 打包主动签名。本仓库默认开启 EV 签名并在失败时中止，不允许退回未签名包。此次重做版本仍为用户指定的 **0.1.170**；打包不等于发布生产更新。

## 接口与凭证

- [EV Sign 官方 API](https://wiki.evsign.cn/api-sign)：向固定的 `https://api.evsign.cn/v1` POST 完整二进制，成功响应为已签名文件。使用 SHA-256、自动时间戳、不追加旧签名。禁止携带许可证跟随重定向。
- 本地许可证：`~/.codex/secrets/haolo-evsign-license.json`，格式为 `{"licenseKey":"许可证 UUID"}`，可含 `password`、`certificateId`。此文件在仓库之外，当前机器已限制文件权限。不要复制到源码、日志或产品资源。
- CI：仓库加密 Secret `HAOLO_EVSIGN_LICENSE_KEY`，只向非 PR 的打包步骤注入。也可通过 `HAOLO_EVSIGN_LICENSE_FILE` 指定本地凭证文件。
- 当前许可证实际证书发布者：**NaisNet Technology Co., Ltd.**；颁发者为 Certum Extended Validation Code Signing 2021 CA；证书到期时间 2027-04-14 UTC。发布者指纹保存在 `scripts/evsign-policy.json`。Windows 会显示这个证书发布者名称。
- 证书更换必须先核对受信链和发布者，再明确更新指纹；不要为通过校验自动接受不同证书。

## 构建顺序

1. 按用户指定版本或发行技能规则确定版本，检查生产地址、类型及运行内核。
2. 编译 native host 和前端资源。
3. `pnpm exec electron-builder --win --x64 --dir --publish never`：先写入图标、版本与 ASAR 完整性资源，再签主程序和自有 native host。
4. `pnpm exec electron-builder --win nsis --x64 --prepackaged release/win-unpacked --publish never`：打入已签名文件，签卸载程序，再签安装程序，最后生成 blockmap。
5. `pnpm run verify:win-signatures`：核对最终主程序、native host、安装包及已嵌入的卸载程序副本，保存 `release/ev-signatures-版本.json`。卸载程序在 NSIS 内部签名回调中接受相同校验，原样副本保存在 `release/ev-signing`。安装包签名前再次验证内部主程序与 native host，防止误用旧的未签名目录。
6. 验证包内资源和第三方签名，记录最终安装包 SHA-256，再复制到桌面“好咯最新安装包”。同版本重做时先备份旧包。

native host 的 `extraResources` 必须使用 `from: resources/bin` 配合 `filter: [haolo-chrome-native-host.exe]`。electron-builder 26.11.1 的单文件复制分支跳过签名 transformer；直接指定 EXE 为 `from` 会漏签。集成测试通过真实复制流程验证辅助程序触发签名、源文件不变且第三方文件不被处理。

`scripts/sign-windows.cjs` 接入 [electron-builder 26 自定义签名接口](https://www.electron.build/v26/docs/api/app-builder-lib.interface.windowssigntoolconfiguration/)。API 返回先保存为独立候选文件：比较可执行内容（仅允许签名区域、PE 校验和及签名对齐改变），然后验证 Windows Authenticode、固定证书、EV 策略 OID `2.23.140.1.3`、实际文件 SHA-256 签名与时间戳，全部通过才替换原文件。失败保留原文件，完整但未通过的响应仅留在构建目录供诊断，不可分发。

签名范围：`haolo_desktop.exe`、`haolo-chrome-native-host.exe`、版本化的 `-Setup.exe` 和 `-Setup.__uninstaller.exe`。OpenAI 内核等第三方文件保留原发布者签名。凭证缺失、证书不符、服务拒绝、网络中断或校验失败均中止，禁止关闭 `forceCodeSigning` 或启用 `signAndEditExecutable=false` 来出包。

## 服务商审核

EV Sign 按许可证审核可签文件。接入时 native host 曾返回 HTTP 400“此文件未审核，请联系管理员审核”；2026-09-19 用户确认服务商已开通，辅助程序复测签名成功。后续构建仍必须逐个验证，不把一次审核通过当成永久可签保证。必须由服务商批准对应真实文件；不要改名、伪造文件信息或关闭签名绕过审核。

主程序、安装程序、卸载程序及辅助程序均需获准。可提供 `resources/bin/haolo-chrome-native-host.exe` 等实际产物给服务商，审核完成后再执行正常构建。尚未完成所有签名校验前，不得把此前的未签名安装包称作签名版。

## 0.1.170 签名重建验收（2026-09-19）

- 四个自有 EXE 均通过固定证书、EV 策略、SHA-256、可信时间戳和 Windows Authenticode 验证；Windows SDK SignTool `/pa /all /v` 为 4/4 成功、零警告、零错误。
- 从最终安装包提取主程序、native host 和卸载程序，其 SHA-256 与已经验证的签名文件逐一相同；应用 ASAR 也与构建输入相同。
- 安装包 `haolo_desktop-0.1.170-Setup.exe`：202629000 字节，SHA-256 `4b66df3f4f48a26830d1d79aa7e5dc72cb634b5f8decc4150f3e9ae80cb0edfe`。
- 本地构建证据：`release/build-0.1.170-20260919-ev-signed`；四项签名报告：`release/ev-signatures-0.1.170.json`。签名凭证不进入这些报告。
