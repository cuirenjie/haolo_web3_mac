# Developer Dashboard 隐私披露填写表

## 单一用途

在用户逐站授权与敏感动作确认后，让 Haolo/Codex 读取必要的 Chrome 页面上下文并执行用户发起的浏览器任务。

## 建议勾选的数据类别

| Dashboard 类别 | 是否处理 | 说明 |
| --- | --- | --- |
| Website content | 是 | 可见文本、结构、选中文本和用户请求的截图 |
| Web history | 是（可选、逐次） | 只有用户主动请求并再次批准时查询，最多 50 条 |
| User activity | 是 | 当前任务需要的标签页/导航/动作状态；不用于画像 |
| User-provided content | 是 | 任务文字和用户明确选择上传的文件 |
| Authentication information | 否 | 不读取 Cookie、密码、OTP、令牌；登录后的页面内容仍按 Website content 披露 |
| Financial and payment information | 否 | 支付字段默认排除；支付动作默认要求接管或强确认 |
| Personally identifiable information | 可能包含 | 页面可见内容或上传文件可能由用户主动提供并包含个人信息，因此按可能处理进行保守披露 |
| Location | 否 | 不请求地理位置权限 |

## 用途声明

- App functionality：是。
- Analytics：否（首发版不采集扩展遥测）。
- Personalization：否。
- Advertising：否。
- Selling to third parties：否。
- Creditworthiness/lending：否。

## 安全与 Limited Use

- 所有数据使用均与公开描述的单一用途直接相关。
- 跨网络传输必须使用 HTTPS/WSS；扩展到同机 Native Host 的本地传输遵循 Chrome Native Messaging。
- 不出售、不用于广告、不允许人工读取（政策允许的有限例外除外）。
- 隐私政策 URL：`https://haolo.com/legal/chrome-extension-privacy.html`
- 主页 URL：`https://haolo.com`
