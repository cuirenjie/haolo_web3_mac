# Haolo for Chrome：商店条目文案

## 基本信息

- 名称：`Haolo for Chrome`
- 分类：`Productivity`
- 主要语言：`中文（简体）`
- 首发可见性：`Private / 仅受信任测试者`
- 单一用途：让用户明确授权 Haolo/Codex 在其已经登录的 Chrome 标签页中读取页面上下文并完成受控浏览器任务。

## 简短说明

让 Haolo 与 Codex 在你已登录的 Chrome 中安全读取页面并完成经授权的浏览器任务。

## 详细说明

Haolo for Chrome 把 Haolo 桌面端中的 Codex 与你正在使用、已经登录的 Chrome 安全连接起来。

你可以让 Haolo 总结当前页面、比较标签页、引用选中文本、填写网页草稿，或在你确认后完成发送、发布、上传和下载等动作。扩展会优先使用页面语义和可访问性信息定位目标，并在每一步后验证结果。

安全与控制：

- 默认不读取任何网站；网站访问需要你逐站授权。
- 页面内容始终按“不受信任的网页数据”处理，不能改变系统指令或授权规则。
- 密码、一次性验证码、支付字段、令牌等敏感输入默认排除。
- 发送、发布、提交、删除、购买和文件上传等外部副作用动作需要单独确认。
- 下载、历史记录和文件上传相关高级权限按需启用，并在动作完成后撤销。
- 你开始键盘或鼠标操作时，自动化会在下一动作前暂停。
- 扩展不保存 Haolo、OpenAI 或第三方模型的长期密钥。

使用要求：

1. Windows 10/11 x64。
2. 已安装并运行 Haolo 桌面端。
3. Google Chrome 121 或更高版本。

## 素材

- 图标：`assets/store-icon-128.png`
- 截图 1：`assets/screenshot-01-sidepanel-light-1280x800.png`
- 截图 2：`assets/screenshot-02-approval-dark-1280x800.png`
- 小型宣传图：`assets/promo-small-440x280.png`
- 大型宣传图（可选）：`assets/promo-marquee-1400x560.png`

## 审核员说明

扩展依赖 Haolo 桌面端通过 Chrome Native Messaging 提供本地桥接。没有桌面端时，侧边栏会显示明确的安装/重连提示，不会尝试远程下载或执行代码。

建议审核路径：

1. 安装受测 Haolo 桌面端；启动后打开“插件 → Chrome → 管理”。
2. 安装扩展并打开任意普通 `https://` 页面。
3. 在扩展侧边栏选择“仅本次允许”，验证页面摘要。
4. 发起普通点击/输入任务，确认动作完成并返回验证结果。
5. 发起“发送/发布”动作，确认 Haolo 桌面端展示不可变摘要，且未批准前页面不发生外部副作用。
6. 打开 `chrome://` 页面，确认扩展拒绝访问。

审核测试账号、桌面安装包下载地址及有效期由发布负责人在 Developer Dashboard 的审核说明中单独提供，不写入扩展源码或公开文案。

## 官方依据

- [商店条目字段与图像规格](https://developer.chrome.com/docs/webstore/cws-dashboard-listing/)
- [发布与上传流程](https://developer.chrome.com/docs/webstore/publish/)
- [发布范围：Private、Unlisted、Public](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution/)
