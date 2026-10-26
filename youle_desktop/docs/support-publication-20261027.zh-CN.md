# Windows 发布与客服能力同步修复（2026-10-27）

本记录属于 SUPPORT-HAOLO-002 的发布衔接补充。交付范围为源码、发布自动化、已安装发布技能和隔离验收；未提交、推送、部署后端或上传新的官方安装包。

## 已确认的根因

生产客服上下文已声明协议 2 和 `set_candle_colors`，但未找到对应 Windows 发布知识记录。`available_actions` 因精确版本/渠道/contract 未匹配而返回空集，模型只能回答说明。原本常用的技能上传脚本只发送安装包，绕过了已有知识包发布入口；仅有源码中的能力和生成知识包并不会启用生产代操作。

## 修复后的发布链路

1. `pnpm --dir youle_desktop run build` 生成知识包和运行时。Vite 插件验证版本、contract、适配器版本及源文件摘要，再将这次构建的知识包嵌入 renderer，随应用进入 `app.asar`。
2. 打包后再次核对 ASAR 内版本和运行时。NSIS 完成签名和 blockmap 后，`artifactBuildCompleted` 从实际打包的 ASAR 提取快照，生成安装包专属的 `.support-bundle.json` 和 `.support-build.json`。支持明确选择的 prepackaged 目录；拒绝非单一 x64 安装包。
3. `tools/upload-windows-release.ps1` 和原 `tools/publish-support-release.mjs --platform windows` 共用发布实现。默认本地预览；正式发布前校验安装包/ASAR/知识包摘要及 EV 签名，发送明确的 `client_variant=haolo_windows_web3` 和 `support_bundle`。
4. 配套后端发布接口在文件上传前拒绝缺失或不匹配的 Windows Web3 知识包。在同一事务关联发布、导入知识并启用精确版本的能力。启用失败回滚记录并清理本次存储对象。
5. 上传器校验服务端回执中的安装包摘要、active 状态、bundle/contract/source 和动作版本。HTTP 200 缺少正确回执也必须失败，并保存 `activated:false` 的响应供核查。

已安装的 `haolo-desktop-release` 技能脚本改为转发规范仓库中的脚本，消除技能维护另一套 EXE-only 上传逻辑的问题。GitHub Windows 构建流程增加发布回归检查并保留安装包专属知识包及构建凭据。

不会自动启用任意新动作：只有知识目录中已批准、客户端有真实适配器、服务端允许且协议版本一致的动作才会开放。协议 2 的精确发布匹配、用户授权和每步复核继续生效。

## 验收证据

- Vite 生产构建和 TypeScript 检查通过；Node/Python 知识包一致性 5 项通过。
- 发布产物与上传回归 7 项通过：包括实际 ASAR 提取、prepackaged 路径、缺包/篡改拒绝、预览无网络、单次携包上传、错误回执拒绝、签名失败不上传。
- 客户端客服、同步、签名和图表设置相关回归首轮 63 项通过；随后新增的打包钩子测试也通过。
- 隔离 PostgreSQL + 真实 FastAPI 路由验证：发布前无能力；发布后生成待授权操作；未同意执行返回 403；同意后 begin/complete 成功；错误版本/contract/渠道无能力；激活异常回滚并删除上传对象。存储与模型响应在该层使用夹具。
- 后端相关回归共 98 项完成验证：首轮 96 项通过，另外 2 项曾因共享工作区其他任务的目录平台值不符合 schema 失败；该外部改动修正后，仅补跑这 2 项并通过，未降低校验。专用本地测试数据库在验收后停止。
- 真实客服上游模型 4/4 通过：原始明确意图、`设置K线红涨绿跌`、带此前意图的“我如何设置红涨绿跌？”均返回 `operate` 和红涨 `#F6465D` / 绿跌 `#2EBD85`；能力为空时不返回操作。输入为构造的发布后上下文，不写生产客服消息或发布数据。
- 将真实模型对 `设置K线红涨绿跌` 返回的操作计划送入真实 Electron renderer。简中/繁中/英文 × 明/暗主题验证授权前不改色、拒绝不改色、同意后通过真实颜色控件修改并保存；同时核对可见颜色控件值。客服 HTTP 在该层使用夹具。

两轮 Electron QA 均完成 16 个结果，其中真实模型计划驱动的一轮包含 6 组红涨绿跌、6 组主题授权及指标/自定义颜色/消耗页/人工接管回归。测试禁止网络行情请求，所以截图的行情区可能显示加载失败；本轮验收覆盖授权、真实设置控件与持久化，没有将截图当作在线行情显示验收。fixture 的操作标题和完成消息也不是客服生产文案。

本地证据位置：

- `youle_desktop/output/support-ai-qa/results.json`：首轮 UI 回归。
- `youle_desktop/output/support-ai-qa-model/results.json`：真实模型计划驱动的 UI 回归和同目录授权/完成截图。
- 后端仓库 `youle_mas-dev/backend/output/support-windows-publication-model.json`：真实模型四个用例。
- `youle_desktop/output/support-publication-20261027/skill-before/`：修改前已安装发布技能备份。

这些验证覆盖发布事务、模型决策及客户端授权执行三个层次；没有将本地夹具验收当作线上整链路已激活，也未重新签发正式 EXE。

## 正式启用顺序

先按后端发布规范将 `app/lab/api/app_updates.py` 的配套接口部署上线，再从已审查、提交的 Windows 候选构建新的签名安装包，使用维护脚本发布并核对回执。提交/部署前保留并区分共享工作区其他任务差异。

不要用当前源码重新生成旧 EXE 的知识包；旧安装版的 contract 不能由新包替代。现有未携知识包发布的安装版不会被本次本地修复自动追认。

发布时保留安装包、两个 support sidecar、`win-unpacked` 和签名验证所需的 `ev-signing` 证据。CLI 的 `--bundle` 仅允许提供与构建凭据一致的文件。

```powershell
# 先审查并提交候选与版本，再构建（不上传）
& ./tools/release-windows.ps1

# 已有正式发布请求时，构建并自动携包发布
& ./tools/release-windows.ps1 -ReleaseNotesPath <three-locales.json> -Publish
```
