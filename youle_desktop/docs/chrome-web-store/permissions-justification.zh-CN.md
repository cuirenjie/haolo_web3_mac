# Chrome 权限用途说明

## 单一用途

扩展唯一用途是把 Haolo/Codex 与用户明确授权的 Chrome 页面安全连接，并完成用户发起、可观察、可中断的浏览器任务。权限不能用于广告、用户画像、数据出售或与该用途无关的分析。

## 必需权限

| 权限 | 当前功能 | 最小化措施 |
| --- | --- | --- |
| `activeTab` | 用户从扩展入口发起任务时访问当前标签页 | 不授予后台永久全站访问 |
| `contextMenus` | 提供“询问 Haolo”选中文本入口 | 只创建一个与单一用途一致的菜单项 |
| `nativeMessaging` | 与本机 Haolo Native Host 通信 | Host 的 `allowed_origins` 仅列出批准的扩展 ID；无通配符 |
| `scripting` | 页面代理缺失时，在已授权标签页恢复注入 | 只注入扩展包内的 `page-agent.js`，无任意脚本和远程代码 |
| `sidePanel` | 展示连接、站点授权、任务和临时权限状态 | 不创建隐藏页面采集数据 |
| `storage` | 保存本机随机 Chrome Profile 实例 ID | 不保存网页正文、密码、令牌或模型密钥 |
| `tabGroups` | 为写任务创建隔离的 Haolo 标签组 | 不改变与任务无关的用户标签组 |
| `tabs` | 列举、定位、复制和更新用户指定的任务标签页 | 返回字段受限；站点策略在读取正文前再次校验 |
| `webNavigation` | 枚举 frame 并对同源/跨域 iframe 分别授权 | 未授权跨域 frame 不读取、不操作 |

## 可选权限

| 权限 | 触发方式 | 生命周期 |
| --- | --- | --- |
| `debugger` | 用户批准本地文件上传后，用 `DOM.setFileInputFiles` 把已授权文件交给指定 input | 单次申请；动作结束即撤销；不暴露任意 CDP passthrough |
| `downloads` | 用户明确要求下载已识别 URL | 单次申请；记录来源和文件名后撤销 |
| `history` | 用户明确要求搜索历史记录并在 Haolo 桌面端再次确认 | 每次请求重新授权；最多返回 50 条；完成后撤销；不能设为永久允许 |

## 站点权限

`http://*/*` 与 `https://*/*` 只位于 `optional_host_permissions`。扩展安装时不取得全站访问；用户按当前 origin 选择“仅本次允许”或“始终允许此网站”。`chrome://`、`file://`、扩展页和 DevTools 始终拒绝。

## 明确不请求

- 不请求 `cookies`、`identity`、`management`、`clipboardRead`、`clipboardWrite`、`webRequest` 或 `<all_urls>` 必需权限。
- 已移除未使用的 `bookmarks` 可选权限。
- 不提供 `eval`、`new Function`、任意 JavaScript 或任意 CDP 命令接口。

官方最小权限政策要求必需和可选权限都必须采用实现现有功能所需的最窄范围：[Chrome Web Store User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)。
