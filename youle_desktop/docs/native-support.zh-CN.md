# Windows 主会话原生客服

实现日期：2026-10-24。

## 入口与业务隔离

- 主工作区左下角“客服”在现有会话区域展示客户端组件，不使用网页、iframe 或 WebView。
- 客服模式隐藏模型会话的分组、模型选择、策略调用等控件，输入提示为“您可以描述任何问题”。顶部右侧提供带灰色圆角边框的“退出客服”按钮，替代客服模式下的自选展开入口；退出后恢复普通会话的自选列表。
- 客服输入框复用模型会话的尺寸、边框、间距及附件／发送按钮样式，不显示手动拖拽扩展手柄；发送、草稿和附件处理仍由独立客服组件管理。
- 客服拥有独立的消息、草稿、附件、发送锁、轮询和历史索引。不会修改 `state.currentThreadId`、模型设置或模型发送状态，不会调用模型中断接口。
- 原模型任务可在后台继续运行；退出客服恢复原会话及面板状态，模型草稿仍由原有草稿系统管理。
- 点击模型历史或“新任务”会离开客服模式。登录、充值、关于设置等原有网页客服入口保留。

## 服务协议

复用官网当前登录用户客服协议，认证和刷新保留在主进程：

- `POST /api/support/website/open`：建立或接续当前咨询。
- `GET /api/support/website/sessions/{id}/messages`：读取消息、状态和客服在线情况。
- `POST /api/support/website/sessions/{id}/messages`：发送文字或附件，失败重试沿用 `client_message_id`，避免重复入库。
- `POST /api/support/website/sessions/{id}/read`：同步已读。
- `POST /api/support/website/sessions/{id}/attachments/sign` 与 `PUT /api/support/attachment-uploads`：签名及上传附件。

网页端服务代码参考：`haolo_front_web3/youle-ai_index/js/haolo-support-20261013d.js`、`youle_mas-dev/backend/app/lab/api/service.py` 和 `app/lab/services/support_sessions.py`。本次未修改或部署后端。

客服会话索引按服务地址及账号 ID 保存在客户端，显示于“最近”；消息重新从服务器读取。活动中的历史咨询可直接续聊；已结束咨询保留记录，通过“继续咨询”走网页现有的新咨询流程。退出客户端客服界面不会结束服务器咨询。

活动界面约 1.8 秒轮询，后台约 5 秒轮询已知活动客服会话；请求互斥，回复内容和状态变化均会更新（包括同 ID 消息撤回）。已读仅在客服可见时提交，切换账号后旧响应不能写入新账号状态。

## 附件

支持官网既有图片、视频、文档、JSON、压缩包和安装包类型，单个最大 1 GiB。选择、粘贴、拖入均由客服组件处理，不经过模型附件处理器。

Renderer 使用 1 MiB 分块 IPC 写入主进程临时文件，再以流上传。主进程限定服务端签发的上传路径，不接收 Renderer 指定的文件路径或任意上传地址；账号凭据和上传签名不传到 Renderer。按发送窗口和账号校验上传所有权，取消、窗口关闭及超时清理临时文件。

不要显式设置流请求的 `Content-Length`：Electron 的网络传输会拒绝该组合；后端支持无此请求头的流式上传，并校验签名内的实际字节数。

## 验证

在 Windows 规范仓库根目录执行：

```powershell
node youle_desktop/scripts/typecheck.mjs
pnpm --dir youle_desktop exec vite build
node youle_desktop/scripts/test.mjs test/native-support.test.mjs test/settings-support-wecom.test.mjs test/youle-api-service-transport.test.mjs test/composer-input-resilience.test.mjs test/composer-session-draft-retention.test.mjs test/composer-thread-routing.test.mjs test/thread-switch-loading.test.mjs test/stream-render-isolation.test.mjs test/conversation-list-minimal.test.mjs test/question-answer-stream.test.mjs test/question-answer-stream-ui.test.mjs
pnpm --dir youle_desktop exec electron scripts/native-support-qa.mjs
```

桌面 QA 使用独立测试窗口、浏览器预览账号、模拟客服接口及本地 HTTP 上传接收端，拦截外部网络。覆盖客服收发、轮询、历史续聊、粘贴附件、失败保留草稿、原模型草稿与模型选择恢复、同一模型历史返回、模型流式回复在客服期间完成，以及简体／繁体／英文与明暗主题。证据输出在 `output/native-support-qa/`。

这些检查不等于生产人工客服实机联调。本次未向真实客服发送测试消息，未打包、签名或上传客户端发布包。
