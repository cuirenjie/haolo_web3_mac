# Windows 0.1.180 正式安装包（M1-460）

2026-10-23。按用户要求同步最新代码到 origin/dev，固定版本 180 重建 Windows x64 Web3 正式 EV 安装包。

## 源码与范围

- 源码提交：`65ca437c88b46e14297083cb4ff2afd23752c7d0`，已推送 origin/dev。
- 在前次 M1-458 交付基础上纳入 M1-459：AI 斐波那契回撤线复用内置配色、实线、填充和比例／价格标签，兼容历史绘图、保留原价位，并调整展示宽度及标签避让。重新编译 Chrome native host。
- 已只读核对“统一斐波那契回撤线样式”会话完成；审查并提交 8 个文件，output 截图和 profile 缓存保持未提交。未改动其他项目。
- 正式业务地址 `https://haolo.com`，渠道 `haolo_windows_web3`；沿用已核验依赖与内核，不自动增加版本号。

## 验收

- 全量 **5220/5220** 通过，无失败、取消或跳过；TypeScript 和 272 模块正式 Vite 构建通过。指定本机已有 Python，未修改测试断言。
- 主程序、native host、卸载程序及安装器四项 EV 签名通过；已批准 Keroro Software Ltd 证书、固定指纹、EV 策略、SHA-256、可信时间戳和 Windows Authenticode 均有效。官方签名 CLI 已校验，无回退或校验绕过。
- 1370 项构建输入稳定；297 项包内源码／前端资源和 324 项附加资源与输入相符。内核 0.163.0 的 47 项哈希和所需 OpenAI 原签名通过。
- 实际封装 ASAR 隔离启动与登录页视觉检查通过；17 项云端策略目录与未登录鉴权边界正常。
- 最终安装器经实际下载器本地镜像失败回退、1 MiB 续传、解包 399 文件同一性及 1500 项包边界审计。179→180 实际差分重建通过：11 次 Range，传输 20155011 字节，重建哈希一致。
- 既有 M1-459 的 156 项定向回归及 53 组图表检查证据保留于 `youle_desktop/.cache/ai-fibonacci-M1-459/`；本轮全量包含其新增测试。
- 构建保留既有大 chunk、Node 弃用和重复依赖提示。未执行真实系统安装、账号绑定或付费分析。

## 交付

- 安装器：`haolo_desktop-0.1.180-Setup.exe`
- 大小：247805400 字节（236.33 MiB）
- SHA-256：`e91937faacae1475bcdf3cbef14b342bbc9fccd25d2a5e426d1375909a875d8f`
- 桌面：`C:\Users\joiec\Desktop\好咯最新安装包\haolo_windows_web3\haolo_desktop-0.1.180-Setup.exe`
- 构建证据：`D:/haolo_windows_web3/youle_desktop/release/build-0.1.180-M1-460-20261023`
- 前次同版本的 8 个桌面文件已逐项校验备份至 `C:\Users\joiec\Desktop\好咯最新安装包\haolo_windows_web3\archive\0.1.180-M1-458-20261023-0b611834`；之前构建目录完整保留。
- [机器验收回执](verification/windows-release-0.1.180-M1-460-20261023.json)。本轮输入清单和日志：`.cache/release-0.1.180-M1-460-20261023/`。

## 发布状态

源码已推送远端 dev，安装包及 blockmap、SHA-256、签名报告和本记录已本地交付。未上传更新系统，未部署 API、Worker 或行情网关。
