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

`scripts/sign-windows.cjs` 接入 [electron-builder 26 自定义签名接口](https://www.electron.build/v26/docs/api/app-builder-lib.interface.windowssigntoolconfiguration/)。API 返回先保存为独立候选文件：比较可执行内容（仅允许签名区域、PE 校验和及签名对齐改变），然后验证 Windows Authenticode、固定证书、EV 策略 OID `2.23.140.1.3`、实际文件 SHA-256 签名与时间戳，全部通过才替换原文件。失败保留原文件，完整但未通过的响应仅留在构建目录供诊断，不可分发。

签名范围：`haolo_desktop.exe`、`haolo-chrome-native-host.exe`、版本化的 `-Setup.exe` 和 `-Setup.__uninstaller.exe`。OpenAI 内核等第三方文件保留原发布者签名。凭证缺失、证书不符、服务拒绝、网络中断或校验失败均中止，禁止关闭 `forceCodeSigning` 或启用 `signAndEditExecutable=false` 来出包。

## 服务商审核

EV Sign 按许可证审核可签文件。接入时主程序已获得可信 EV 签名；native host 返回 HTTP 400“此文件未审核，请联系管理员审核”。用户已表示联系服务商核实可签列表。必须由服务商批准对应真实文件；不要改名、伪造文件信息或关闭签名绕过审核。

主程序、安装程序、卸载程序及辅助程序均需获准。可提供 `resources/bin/haolo-chrome-native-host.exe` 等实际产物给服务商，审核完成后再执行正常构建。尚未完成所有签名校验前，不得把此前的未签名安装包称作签名版。
