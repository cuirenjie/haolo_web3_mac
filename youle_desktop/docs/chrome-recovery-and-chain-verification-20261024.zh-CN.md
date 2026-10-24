# Chrome 0.1.1 代码恢复与链路验收

日期：2026-10-24。工作仓库：`C:/Users/潘艳芳/Documents/ChatGPT/haolo_windows_web3`。

## 代码恢复

用户从 Chrome Web Store 开发者后台“文件包 → main.crx”下载的文件已保存到下载目录：

- `nghigncngejomffadebehdhlkfpdokmh.crx`，67,644 字节，CRX3，Haolo for Chrome 0.1.1。
- SHA-256：`991f1bd4410feab718674530505b5c4cfe744a2a2e528fe2a00fcb0863880b1a`。
- 同名 `(1).crx` 与原文件哈希相同。Chrome 显示“无法从此网站添加扩展程序和应用”时，文件实际上已经落盘；该提示不表示代码包丢失。
- 原包备份和提取文件：[恢复目录](../output/chrome-store-recovery-20261024/)。逐文件比较：[comparison.json](../output/chrome-store-recovery-20261024/comparison.json)。

仓库原有扩展版本为 0.1.0，Git 路径历史只有 `23519b3` 初次导入。现已将审核包中的 service-worker、sidepanel、task-messages 恢复到 `extensions/haolo-chrome/`。其余 JS、HTML、CSS 和图标逐字节一致。manifest 的功能字段与审核包一致；开发目录保留开发 key 和 `-dev` version_name，不复制商店添加的 update_url 和 `_metadata`。

恢复的是可维护的扩展运行代码和资源；审核包不包含另一台电脑的 Git 历史、桌面源码或原始测试。无需从零重写扩展，也无需为这次恢复重新提交同一 0.1.1 包。

截图中的商店状态是“可以发布”，右侧明确“此产品尚未发布”。尚未验证个人 Chrome 的商店安装和商店自动更新。

## 桌面修复

- Native Host 注册表诊断改用 Unicode Registry API，以 UTF-16LE/base64 传输路径，避免中文 Windows 用户目录被 reg.exe 的控制台编码破坏。
- 修复带品牌图标的 Windows 开发版被 Electron 判为 `isPackaged=true` 时的资源路径：Native Host、发布配置和扩展目录统一从实际仓库解析。实际开发版日志此前报 host missing，误找到了 `node_modules/electron/dist/resources/bin`；正式安装版仍使用安装资源目录。
- Renderer 订阅 `chrome:task`，为侧边栏任务建立可见 Codex 会话；订阅后读取待处理队列，避免窗口初始化前的任务丢失。
- 按用户最新要求仅使用 DeepSeek。侧边栏入口不再使用只接受 GPT 的筛选器，改用 `chromeTaskModelOptions` 校验已授权的 DeepSeek 执行模型；只有 DeepSeek 的模型池也可接收任务，缺失时明确报错，不回退 GPT。
- 同一 taskId 去重；绑定独立 task_handle 后复用扩展已创建的任务标签页。页面快照不拼接到用户指令，模型通过 read_page 获取带不可信标记的网页内容。
- 启动成功或失败通过 Native Host 回传 `task.status`，兼容已审核 0.1.1。
- 新建任务页后禁止沿用源页的 element_id/坐标，要求重新读取任务页。Chrome 持久授权在桌面重启后仍可用，撤权优先于旧的桌面内存授权。
- 多 Profile 的全部工具支持 profile_id；外部操作提交与任务上下文绑定，拒绝跨任务消费审批。取消后撤销 task_handle。
- MCP 与 CLI 的调用超时覆盖五分钟审批窗口，避免 45 秒后等待审批的请求先断开。
- 本地发布配置启用 100% 并要求扩展至少 0.1.1，消除原先 5% cohort 使本机永远无法调用工具的问题。此为源码改动，未发布 Windows 安装包或修改线上更新系统。

## 验证结果

- Chrome 专项自动测试：92/92 通过，无跳过。其中历史的 50 项是静态/契约检查，已更名为 contract baseline，不能当作 50 次真实浏览器 E2E。新增 DeepSeek-only 模型池与品牌开发版资源路径回归，验证不要求、不回退 GPT。
- TypeScript 类型检查：通过。
- Vite 构建：通过；保留现有大 chunk 警告。
- 真实 Chrome for Testing 156.0.8078.47：原传输检查 10/10 通过；加入真实 Codex CLI + DeepSeek 模型后 11/11 通过。[最新真实模型报告](../output/chrome-native-e2e/live-current-route-report.json)。
- 路径为真实 MCP stdio 进程 → loopback HTTP bridge → Broker → Windows named pipe → 已安装 Native Host → MV3 → 本地 HTTP 测试页面。已安装 Native Host 的 Windows Authenticode 状态为 Valid。
- 覆盖未授权访问拒绝、读取和敏感字段过滤、独立任务页点击、原页不变、文本输入、下拉选择、外部写直接点击拒绝、审批后仅提交一次、滚动和等待、侧边栏任务接收/绑定/回执、桌面 runtime 重启后保留站点授权。
- 测试使用临时 Chrome profile 和仅含合成数据的 loopback 网站；未修改个人 Chrome profile、用户注册表或原有 Native Host 配置。隐藏窗口测试需关闭 Chrome 的遮挡节流，否则 duplicated tab 的文档会保持未恢复状态。

运行命令（从仓库根目录执行）：

```powershell
node --test youle_desktop/test/chrome-*.test.mjs
node youle_desktop/scripts/typecheck.mjs
pnpm --dir youle_desktop build
$env:HAOLO_CHROME_EXECUTABLE = 'D:\CodexBuildCache\chrome-for-testing-156.0.8078.47\chrome-win64\chrome.exe'
node youle_desktop/scripts/chrome-native-e2e.mjs
```

## 503 定位与真实模型验收

另外启用了真实 bundled `haolo_ai.exe` app-server 和当前已登录 Haolo 模型会话；密钥只在内存/子进程环境中使用，未输出、未写入测试配置。

最初两次测试硬编码 `gpt-5.6-sol` 和 GPT 凭据，向 `https://haolo.pro/v1/responses` 发请求，返回 HTTP 503，尚未调用 Chrome 工具。失败证据保留：

- 首次请求 ID：`fe53d9f5-6def-4873-b587-1559a79fe644`。
- 重试请求 ID：`33e9d6ef-bdc3-43ad-9c89-dd23cf3db2fa`。
- [首次报告](../output/chrome-native-e2e/live-model-report.json)、[重试报告](../output/chrome-native-e2e/live-model-retry-report.json)。

通过现有 SSH 跳板只读核对生产网关 `8.216.43.79`：API blue 为 `9a18abcd583e8af326e7dad3f2ac6f94dedc5654`，Worker 为 `90b97e255fa054821f91088459cf6fe0bfc03139`，两者 healthy、0 restart。日志精确匹配两次请求，原因均为 GPT group 2 的 `no available accounts`。该分组账号 12、14、16、67 均为 schedulable=false，67 另有 error 状态；DeepSeek group 15 的 68–72 均 active、schedulable=true。用户明确要求只使用 DeepSeek，因此未启用 GPT、未改账号调度、未部署网关或覆盖其他会话的 DeepSeek 改造。

修复测试与侧边栏的旧模型选择后，使用业务模型目录授权的 `deepseek-flash`、对应 group 15 凭据和客户端现有 `ModelRequestRelay`。该 relay 路由到 `/v1/mobile-analysis/responses`，沿用计费契约；`gpt-v1` 是计费响应头，不表示实际调用 GPT。

2026-10-24 12:24 北京时间最终复测：bundled Codex CLI 收到真实侧边栏表单任务，经过生产 `chromeTaskModelOptions` 和 `createChromeTaskReceiver`，调用真实 MCP `read_page → click → read_page`，页面出现 `Details opened`；原标签页不变，未额外重复创建任务页，侧边栏收到 accepted 回执。4 次真实模型 HTTP 请求全部 200，记录如下：

- `06b62178-5e09-4f33-91a0-321b71f92579`
- `7ab47ae7-4f91-4ba5-a8a1-f0136a2dc876`
- `34abcec9-a797-4ad7-807c-88e09d561695`
- `29d54b23-1c6f-457c-ad77-88450439f380`

此前同路由成功测试的 4 个请求亦在生产 access log 核对为 HTTP 200、account 72、model deepseek-flash。该测试证明真实模型与浏览器链路；任务接收复用生产函数但线程适配器直连 CLI，不把它描述为已完成个人 Chrome 商店安装后的 Electron UI 验收。

重跑命令（只允许 DeepSeek）：

```powershell
$env:HAOLO_CHROME_LIVE_MODEL = '1'
$env:HAOLO_CHROME_E2E_REPORT = 'youle_desktop/output/chrome-native-e2e/live-current-route-report.json'
node youle_desktop/scripts/chrome-native-e2e.mjs
```

## 商店发布与个人 Chrome 验收

真实模型测试已通过；正式商店安装后的产品验收仍需用户完成浏览器确认：

1. 开发者后台打开 Haolo for Chrome，选择“版本 → 状态”，发布已经审核的 0.1.1；保持现有分发范围，无需重新上传相同包。
2. 后台显示“已发布”后，打开 https://chromewebstore.google.com/detail/nghigncngejomffadebehdhlkfpdokmh ，点击“添加至 Chrome → 添加扩展程序”。下载的 CRX 是恢复备份，不用拖入 Chrome 强装。
3. 保持包含本次修复的 Haolo 开发版运行；若提示源码已更新，使用应用的重启按钮载入更新。现有已安装的旧客户端不能替代本次修复版本，本任务未发布新 Windows 安装包。
4. 打开 https://example.com ，点击 Haolo 扩展，在侧边栏授权当前网站并发送“读取这个网页，告诉我页面标题和首段内容”。核对 Haolo 出现可见任务、工具读取及最终回答，侧边栏不再停在等待桌面接收。
5. 如果显示未连接，在 Haolo 的 Chrome 插件页面运行连接诊断/修复后重试；商店扩展 ID 必须为 `nghigncngejomffadebehdhlkfpdokmh`。

本机注册的 Native Host manifest 已包含正式 ID 和开发 ID，中文路径读取正常。最终测试报告仍如实标记 `installedStoreExtension=false`，直到完成上述商店安装与人工侧边栏验收。

12:27 北京时间，实际 Haolo 开发版重启后记录 `Haolo Chrome native broker is ready`。独立读取注册表并执行 manager.diagnose：healthy=true、issues=[]，Host 路径已正确指向规范仓库，正式商店 origin 已允许。开发版路径修复已在实际进程生效。用户随后截图仍为“可以发布”，商店发布/安装尚未完成。

官方步骤：https://developer.chrome.com/docs/webstore/publish 、https://support.google.com/chrome_webstore/answer/2664769?hl=zh-Hans 。
