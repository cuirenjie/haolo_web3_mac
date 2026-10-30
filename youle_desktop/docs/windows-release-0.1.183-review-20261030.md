# Windows 0.1.183 签名待审包

2026-10-30（Asia/Shanghai），RELEASE-183-20261030。本次用户授权为制作签名安装包并起草更新说明，审核后再发布官网。构建及本地验收完成；未上传、未修改官网更新策略、未部署后端或其他服务，客服知识包尚未生产激活。本任务未推送 Git，也未安装或启动可见客户端。

## 审核版更新说明

1. 新增专业越南语支持，优化多语言文案及大字号显示。
2. 新增 MACD 柱颜色切换和隐藏价格轴设置，完善图表偏好同步。
3. 顶部行情标签支持隐藏与恢复，关闭标签时保留自选收藏。
4. 价格预警支持点击价格直接修改，优化创建及改价后的响应。
5. 优化分析前的准备流程，完善模型回复不完整时的提示。
6. 修复充值后权益刷新等已知问题，提升使用稳定性。

六语言发布文本见 [release-notes-0.1.183.json](release-notes-0.1.183.json)，覆盖简中、繁中、英文、韩文、日文、越南文。未宣称生产实测提速比例或盈利效果。

## 产物与来源

- 产品基线：`8fa4c681ef09bdd37f593a6051f9eee5e0359e04`，任务开始时与 origin/dev 一致。
- 版本及说明提交：`18f9869429edfbf630eada4526c293dcb4f2d23e`。
- 最终构建源码：`7b5ccef2487dc46d9510bcfce817927c42e5db65`。
- 安装包：`haolo_desktop-0.1.183-Setup.exe`，Windows x64，252746448 字节。
- SHA-256：`2373fad0e601c97349544ecae4f6e2600d913ed6f7139fb06c3124487b1b4f1c`。
- 原产物：`youle_desktop/release/haolo_desktop-0.1.183-Setup.exe`。
- 冻结交付目录：`youle_desktop/release/build-0.1.183-20261030/`。内含同次安装包、blockmap、`win-unpacked`、已签卸载器副本、六语言说明及原封 sidecar，供审核后的既有发布器直接验证。
- 桌面副本：`C:/Users/潘艳芳/Desktop/好咯最新安装包/haolo_desktop-0.1.183-Setup.exe`。同目录保留两份客服 sidecar、blockmap、签名报告、六语言 JSON 和中文待审说明，复制后逐文件 SHA-256 一致。
- 同次客服 sidecar：`haolo_desktop-0.1.183-Setup.exe.support-bundle.json` 和 `haolo_desktop-0.1.183-Setup.exe.support-build.json`；contract 为 `15c7c295e91bf2cfb2b6e7684d9afe41561a3ef85c90f28cd49385216f6cb9ca`。
- 未产生生产 publication receipt；标准发布器仅执行本地 preview，`activated:false`。

## 验证

- 全量测试 5979 项：5978 通过、0 失败、1 项因 NSIS 诊断编译器缺失跳过；正式构建下载编译器后补跑该项通过，覆盖 26 个安装／升级快捷方式场景。最终 5979 个不同用例均通过。
- 类型检查、native host 编译、Vite 生产构建、签名 win-unpacked、NSIS 与 blockmap 构建成功；保留现有大 chunk 提示。
- 主程序、native host、安装器和卸载器四项 Authenticode 均 Valid；SHA-256、GlobalSign EV 策略、固定证书指纹 `EC6346287B2F343CB7BFA4CF4CAB7DB02379A0AD` 和 DigiCert 时间戳全部通过。本次未启用 auto 时间戳或 API 回退。
- 包内 295 个主进程／共享运行文件与构建源码逐字节一致；120 个客服源文件与封存知识快照一致。ASAR SHA-256 为 `9295d5a3ba2c49f934370cfc2368f44e01892dc701b6cb0e167bdacf729b48a7`。
- 内置运行时 47 文件摘要及要求的 OpenAI 原签名通过；最终 2087 个包内资源的私有代码／凭据检查通过。
- 从最终安装器提取主程序、native host 和 ASAR，摘要与已验签构建逐一一致。卸载器由 NSIS 签名钩子验证并保留原封副本。7za 识别安装器内嵌 7z 时报告尾随 NSIS／签名数据，提取正常完成且三个文件摘要匹配。
- 原包与冻结副本的标准发布 preview 均通过；冻结目录四项签名另行复核，便于后续审核后发布。

初轮回归发现顶部标签文案未接入通用词库、MACD 英繁词库键不一致及三个旧布局断言。已补齐词库并使旧断言对应已批准的新行为，保留自选／MACD 功能测试，不放宽生产校验。初轮构建在签名前停止；随后测试占用 native host 导致一次编译失败，测试结束后按原发布脚本重建成功。下载延迟自然恢复，未替换 Electron、跳过签名或调整固定证书。失败和成功日志均保留在冻结目录。

本次是本地构建验收，未做真实客户账户或线上模型端到端验收。后续发布须再次检查生产基线与授权，并使用这里封存的安装包及原 sidecar，不从新源码重生成旧包知识文件。

机器记录：[windows-release-0.1.183-20261030.json](verification/windows-release-0.1.183-20261030.json)。
