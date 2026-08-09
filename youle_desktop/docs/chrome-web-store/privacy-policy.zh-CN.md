# Haolo for Chrome 隐私政策（送审草案）

> 状态：工程草案，发布前必须由 Haolo 法务/隐私负责人确认主体名称、联系方式、公开 URL、生效日期和 Haolo 主服务的数据保留条款。

生效日期：`2026-08-07`

运营主体：`Shenzhen Haolo Technology Co., Ltd`（深圳市好咯科技有限公司）

联系邮箱：`info@haolo.com`

## 1. 适用范围

本政策说明 Haolo for Chrome 扩展如何处理信息。扩展的单一用途，是在用户明确授权后，把 Haolo 桌面端中的 Codex 与用户正在使用的 Chrome 标签页连接起来，以读取必要页面上下文并完成用户发起的浏览器任务。

## 2. 处理的信息

在功能需要且获得相应授权时，扩展可能处理：

- 当前标签页的标题、URL、可见文本、可访问性语义、可见链接和非敏感表单元数据；
- 用户明确选中的文本和当前可见页面截图；
- 用户发给 Haolo 的任务文字以及动作目标、结果和错误类别；
- 用户单次批准的浏览历史查询和最多 50 条匹配结果；
- 用户明确选择用于上传的本地文件，以及为完成上传所需的本机路径；
- 下载 URL、建议文件名和下载结果；
- 本机随机生成的 Chrome Profile 实例 ID、扩展版本、连接状态和不含网页正文的诊断事件。

扩展默认排除密码、一次性验证码、支付卡字段、安全码、令牌、Cookie 和被网站标记为私密的表单值。扩展不读取 Google 账号身份，也不保存 Haolo、OpenAI 或第三方模型的长期凭据。

## 3. 使用目的与处理路径

上述信息只用于提供或改进用户可见的 Chrome 任务功能，包括理解页面、定位目标、执行经授权动作、验证结果、恢复故障和防止越权。

信息首先通过 Chrome Native Messaging 发送到同一台计算机上的 Haolo Native Host 和 Haolo 桌面端。用户把页面内容加入 Haolo/Codex 任务时，为生成结果所必需的最小内容可能由 Haolo 桌面端发送到用户当前选择的模型服务。相应服务、区域、保留期限和删除方式在 Haolo 主服务隐私政策 `https://haolo.com/legal/privacy.html` 中公开说明。

## 4. 保存期限

- 扩展不持久保存网页正文、页面截图、浏览历史结果、表单值或本地文件路径。
- 扩展本地存储仅保留随机 Profile 实例 ID 和用户主动选择的 Chrome 权限状态；用户可通过撤销权限或卸载扩展清除。
- Haolo 桌面端 Chrome 审计默认只在内存中保留最近 200 条脱敏事件，不记录网页正文、凭据或授权令牌，退出应用后清除。
- 用户主动发送到 Haolo 任务中的内容，按 Haolo 主服务公开的数据保留与删除政策处理。

## 5. 分享、出售与广告

我们不出售扩展处理的信息，不将其用于个性化广告、重定向广告、信用评估或与扩展单一用途无关的用户画像。除提供用户请求的功能、遵守法律、处理安全事件或依法完成企业交易所必需的情形外，不向第三方转移信息。

除用户针对具体支持请求给予同意，或安全调查、法律义务及内部聚合匿名分析等政策允许的有限例外外，不允许员工人工读取用户的页面内容或个人通信。

## 6. 安全措施

- Native Host 仅允许清单中的精确扩展 ID；不接受通配符来源。
- 本地 Broker 使用当前 Windows 用户隔离的 Named Pipe 和每次启动随机生成的短期令牌。
- 站点、标签页、线程、任务、工具和文件通过短期 Capability Grant 绑定。
- 发送、发布、提交、删除、购买和文件上传采用 prepare/approve/commit 两阶段控制与幂等 operation ID。
- 网页内容始终标记为不受信任数据，不得改变系统目标或权限。
- 发送到网络服务的个人或敏感数据必须使用现代加密传输。

## 7. 用户控制

用户可以逐站选择仅本次允许、始终允许或拒绝；可以随时在 Chrome 扩展设置中撤销网站和可选权限；可以在 Haolo 中拒绝待执行动作、取消任务或删除相关会话；也可以卸载扩展。历史记录没有永久授权选项。

## 8. 儿童、变更与联系

本扩展不面向法律规定年龄以下的儿童。若数据处理方式发生实质变化，我们会更新本政策，并在扩展界面或商店条目中提供显著说明并按要求重新取得同意。

隐私问题、访问或删除请求请联系：`info@haolo.com`。

## Chrome Web Store Limited Use 声明

Haolo for Chrome 对从 Chrome API 获取的信息的使用与转移遵守 Chrome Web Store User Data Policy（包括 Limited Use 要求）：只用于提供或改进扩展的单一、用户可见功能；不用于个性化广告；不出售；不允许人工读取，政策明确允许的有限例外除外。

参考：[Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) 与 [Disclosure Requirements](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements)。
