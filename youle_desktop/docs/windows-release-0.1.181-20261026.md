# Windows 0.1.181 正式发布安装包

2026-10-26，按用户要求使用最新代码，补丁版本从 0.1.180 增加到 0.1.181。

## 源码与范围

- 规范仓库：C:/Users/潘艳芳/Documents/ChatGPT/haolo_windows_web3。已执行 fetch --prune / pull --ff-only，基线 6c2fc5fd0b612d147025828ac57b2f66e5abb622。
- 包含已完成的 LOLO 默认名称修改，以及本轮发现并修复的打包依赖遗漏和翻译缺项。源码基线加完整工作区差异保存在 C:/Users/潘艳芳/Documents/ChatGPT/haolo_windows_web3/.cache/release-0.1.181-20261026/source-changes.patch；未提交或推送。
- 生产业务地址 https://haolo.com，Windows x64 渠道 haolo_windows_web3；模型网关保持仓库配置。
- 首个候选缺少 admission-recovery.mjs，实际 ASAR 启动验收失败。已补入显式打包清单和公共模块允许列表，并重新构建、签名。旧候选已标记禁止分发。

## 验证

- 全量 5805/5805，失败、取消、跳过均为 0；类型检查和 Vite 正式构建通过。
- 全量测试先发现生成目录被源码扫描及旧测试夹具缺少新的取消依赖；已纠正扫描范围和夹具。云端同步测试按现行静默事件同步契约验证。
- 四项 EV 签名均 Valid：主程序、Chrome native host、卸载程序副本和安装器；Keroro Software Ltd，SHA-256、可信时间戳及固定 EV 证书验证通过。
- 1744 项构建输入未漂移；474 项包内源码／前端资源、327 项附加资源一致。内核 0.163.0 的 47 项哈希及所需 OpenAI 原签名通过。
- 真实封装 ASAR 在隔离目录启动并完成登录页视觉检查，17 项云端目录和未登录鉴权检查通过。
- 最终签名安装器通过实际下载器的本地故障镜像回退、1 MiB 续传；解包 403 个文件与 win-unpacked 逐项一致，2078 项包边界审计通过。
- 同次构建的 support-bundle.json 包含 93 项功能，源文件摘要验证通过。
- 未执行真实系统安装、用户登录或付费分析。构建保留既有大 chunk、实验功能、依赖重复及弃用提示。

## 交付

- 安装器：haolo_desktop-0.1.181-Setup.exe
- 大小：251491744 字节（239.84 MiB）
- SHA-256：7bd1c736e049a29f4dcc9484e23fa6b3eacf0561520c0b36baeaf87109a7cf1e
- 构建目录：C:/Users/潘艳芳/Documents/ChatGPT/haolo_windows_web3/youle_desktop/release/build-0.1.181-verified-20261026
- 桌面目录：C:/Users/潘艳芳/Desktop/好咯最新安装包/haolo_windows_web3
- 同目录附带 blockmap、SHA-256、EV 签名报告、客服知识包及本记录。
- [机器验收回执](verification/windows-release-0.1.181-20261026.json)。日志与输入清单位于仓库 .cache/release-0.1.181-20261026。

本次完成本地正式安装包。未上传生产更新系统，未部署其他服务；OSS 对象和下载地址尚未生成。工作区保留 LOLO 会话修改、版本、打包修复、翻译、测试修复及重新编译的 native host。
