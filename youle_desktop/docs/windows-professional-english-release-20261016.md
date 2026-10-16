# Windows 专业英文分析安装包发布记录

当前最新交付为 **0.1.180**，见 [复杂波浪 Windows 修复及安装包](complex-wave-windows-release-20261017.md)。0.1.179 见 [新一轮真实模型验收及安装包](english-revalidation-20261016.md)。下文保留 0.1.176 至 0.1.178 的历史证据。

2026-10-16，用户授权重新打包 M1-349 英文分析修复。源码和 Git 根目录均为 `C:/Users/潘艳芳/Documents/ChatGPT/haolo_windows_web3`，远端 dev 已同步，保留工作区的 M1-348／M1-349 和已批准的 EV 签名配置。版本由 0.1.175 升至 0.1.176；业务 API 保持当前源码生产入口 `https://haolo.com`。历史发布技能中的 D 盘目录和 youle.pro 不作为本次源码或生产地址。

- 安装包：`C:/Users/潘艳芳/Desktop/好咯最新安装包/haolo_windows_web3/haolo_desktop-0.1.176-Setup.exe`。
- 大小：209743424 字节；SHA-256：`7bcdb173726ef89152e065e3d1d0d4710521c2b8380f6286f46abb907beed1b5`，旁边保存同名 `.sha256`。
- 构建和验证证据：`youle_desktop/release/build-0.1.176-english-20261016/`。
- 主程序、安装程序、嵌入卸载程序、自有 Chrome native host 四项签名均 Valid，EV 发布者 Keroro Software Ltd，固定指纹 `EC6346287B2F343CB7BFA4CF4CAB7DB02379A0AD`，SHA-256及可信时间戳通过。安装包提取出的三项程序／ASAR与已验证输入逐一同哈希。
- ASAR 内420个源码／构建文件和241个外部资源与本次输入一致，8个英文报告／模型语言模块在包内。native host 可执行内容与本次编译一致；默认 auth 无密钥。内置 Codex 0.157.1 的三个运行时文件哈希及 OpenAI 原签名通过。
- 相关572项桌面回归已通过，本次重新执行 typecheck、native host 编译和 Vite build 成功，只有既有大chunk提示。仅生成本地 EV 签名安装包，未上传生产更新系统、未覆盖当前安装客户端。安装0.1.176并在英文界面重新发起分析后，才会使用新结论生成逻辑；历史会话正文不自动翻译。

本次验证不包含付费真实模型调用或安装后的实机界面端到端验收。移动 Worker 的独立上线回执记录在后端仓库，不能由此安装包记录推断。

## 0.1.177：真实模型复验后的修订包

M1-350 继续修复真实模型审阅发现的英文截断、句法、术语、重复事件时间、SMT 比较标注、结构参考与最终执行方案的区分。分析计算与风险规则不变。

- 最新安装包：`C:/Users/潘艳芳/Desktop/好咯最新安装包/haolo_windows_web3/haolo_desktop-0.1.177-Setup.exe`。
- 大小 209747776 字节；SHA-256 `97a69ab79f74af0f4e00fa9f7c74505a861848d7d7904f1f0457ee7f2042c0f7`。
- 主程序、自有 native host、安装程序、签名钩子留存的嵌入卸载程序共四项 EV 签名 Valid，Keroro 发布者、固定指纹、SHA-256 和 DigiCert 时间戳通过。第三方 Codex 0.157.1 三个运行时原签名与清单哈希通过。
- ASAR 423 个源码/构建文件和 247 个外部资源与构建输入一致，默认认证值为空。ASAR SHA-256 `d648306cefab044c5f48c503b9f37065a278852d6b0a154f39b787cd612d959f`。安装包提取后的主程序、native host、ASAR 三项与签名输入一致；卸载程序验证的是签名钩子保存的嵌入前文件，未声称另行从 NSIS 提取验证。
- typecheck、native host 和 Vite 构建通过；最终英文与策略/指标专项 393/393 通过，未重复计入此前专项。安装包首次最终签名出现“合并文件失败”，保留失败日志后按相同官方 CLI 重试成功。
- 最终构建证据：`release/build-0.1.177-real-english-final-20261016/`；真实模型证据：`output/real-model-language-20261016/`。模型验证使用真实计费服务及合成行情，不是安装后的原生 App Server 或真机 UI 验收。
- 仅交付本地安装包，未安装覆盖当前客户端，未上传更新渠道。英文界面重新发起的分析使用修复逻辑，既有中文历史报告不回写。

## 0.1.178：最终 VPVR 语义修订和全入口真实模型验收

在 0.1.177 基础上，修正 VPVR 对价值区位置与接受/拒绝的区分，补充 HVN/LVN 仅描述历史成交量的约束。最终真实模型复审 `professionalEnglish=true`、`issues=[]`；17 个 Windows 分析入口的最终英文样本均通过，相关回归 430/430，详见 [逐入口验收](real-model-english-acceptance-20261016.md)。

- 最新安装包 `C:/Users/潘艳芳/Desktop/好咯最新安装包/haolo_windows_web3/haolo_desktop-0.1.178-Setup.exe`，209747872 字节，SHA-256 `4259cd8175a7daf8f6b58fb344051960e03c9a4af655998ae214f7609d201a4f`。
- 四项自有程序 EV 签名 Valid，Keroro 固定发布者、SHA-256 和 DigiCert 时间戳通过；三个 OpenAI 运行时原签名和清单哈希保持。
- ASAR 423 个源码/构建文件、247 个外部资源与最终构建输入一致，8 个语言模块在包内，默认 auth 为空。ASAR SHA-256 `7079b3b9c30bd445da104a923492f8775d57b20e18e0b57c143cd1dc265e70df`。
- 安装包独立提取出的主程序、native host、ASAR 三项同哈希；卸载程序为签名钩子留存的嵌入前文件验签，不声称独立提取。
- typecheck、native host 编译和 Vite build 通过，最终证据 `release/build-0.1.178-real-english-20261016/`。仅本地交付，无更新渠道上传或当前安装覆盖。
