# Chrome 扩展发布、灰度与回滚手册

## A. 首次 Private 发布

1. 完成 Chrome Web Store 开发者账号注册、身份/联系邮箱验证和发布者信息。
2. 运行真实 Chrome 冒烟、素材生成、商店打包和发布预检。
3. 在 Developer Dashboard 新建条目并上传 `release/chrome-extension/haolo-chrome-store.zip`。
4. 填写 Listing、Privacy 和 Distribution；首发选择 `Private`，只添加受信任测试账号或受控 Google Group。
5. 记录 Dashboard 分配的 32 位扩展 ID。
6. 运行：

   `node scripts/configure-chrome-release.mjs --extension-id <STORE_ID> --channel internal --rollout 5`

7. 重新构建并签名 Haolo 桌面安装包，使 Native Host 的 `allowed_origins` 同时接受开发 ID 和商店 ID。
8. 用签名安装包在干净 Windows 10/11 x64 环境验证安装、升级、卸载和一键修复。
9. 在 Dashboard 使用 deferred publishing 提交审核；通过后手动发布给 Private 测试组。

所有可见性都会经过相同政策审核。Private 应用于受控测试；Unlisted 只是不出现在搜索中，任何获得 URL 的人仍可安装，不作为首发内测边界。

## B. 灰度

Chrome Web Store 原生百分比 rollout 只在已有版本且七日活跃用户超过 10,000 时出现，首发阶段使用 Haolo 自身的确定性安装桶：

1. 5%：内部员工和指定客户；至少 48 小时。
2. 20%：扩大测试组；至少 72 小时。
3. 50%：覆盖主要 Chrome 稳定版和 Windows 10/11；至少 7 天。
4. 100%：满足门槛后全量。

每次调整：

`node scripts/configure-chrome-release.mjs --channel <internal|beta|production> --rollout <0-100>`

策略通过下一版受签名 Haolo 桌面配置发布。扩展版本不兼容时只读/写能力会按兼容矩阵自动失败关闭；`emergencyWriteDisabled` 可仅停止写操作，`emergencyDisabled` 可停止全部工具调用。

## C. 放量门槛

- 50 项基准：50/50 通过。
- 只读成功率 ≥95%；核心动作成功率 ≥90%。
- 未授权成功执行 = 0；跨站越权 = 0；高危缺陷 = 0。
- 本地授权 p95 ≤200ms；典型结构快照 p95 ≤500ms。
- 明暗主题、安装、审批、用户接管、断线和一键修复通过。
- Native Host 与桌面安装程序 Authenticode 状态均为 `Valid`。
- 支持邮箱、隐私政策和事故联系人可用。

## D. 紧急回滚

按影响从小到大：

1. 只停写：`--emergency-write-disabled true`，保留页面只读和诊断。
2. 全停用：`--emergency-disabled true`，Broker 对所有工具调用 fail-closed。
3. 发布桌面配置热修复/安装包更新，并在扩展侧边栏展示可操作错误。
4. Chrome Web Store 停止发布、回退上一已审核版本或下架。
5. 若是 Native Host 问题，发布签名 Host/桌面修复包；不要求用户重装扩展。
6. 修复后先 Private 5% 重新验证，再逐级恢复。

回滚演练必须记录触发时间、策略版本、受影响版本、恢复时间、重复副作用检查和审计结论。

## E. 外部依赖

- Chrome Web Store 开发者账号和受信任测试账号。
- Google 分配的正式扩展 ID。
- 可公开访问的 HTTPS 隐私政策/主页/支持地址。
- Windows 代码签名证书或组织签名服务。
- 法务/隐私负责人对政策文本的批准。

官方参考：[分发设置](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution/)、[更新与百分比 rollout 条件](https://developer.chrome.com/docs/webstore/update)、[审核流程](https://developer.chrome.com/docs/webstore/review-process)。
