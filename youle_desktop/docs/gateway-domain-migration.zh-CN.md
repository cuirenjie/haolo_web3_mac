# Web3 客户端模型网关域名迁移

## 地址分工

- 账号、登录、余额、模型池配置、应用更新：`https://haolo.com`。
- GPT、DeepSeek、其他模型及图片/视频中转：`https://haolo.pro/v1`。
- `aiapi.youleai.top` 已停用，不再作为回退地址。

`src/main/haolo-gateway.mjs` 统一模型网关默认值和迁移规则。仅迁移已知旧网关域名及历史 IP 的默认服务端口；自定义服务、其他端口、相似域名和账号服务地址保持不变。

## 已有用户升级

新代码启动时会迁移已保存会话和各模型 Key 的 base URL；Key 本身、账号和设备标识不变。已有认证文件的高优先级 LLMHUB/SUB2API 地址也会归一化，避免覆盖新默认值。

资源同步会更新两个运行时 home 的 provider 配置，以及内置图片/视频脚本。视频恢复任务中保存的旧轮询 URL 会迁移到新域名并保留任务参数。自定义 provider 和权限配置不在本次迁移范围内。

仅修改 DNS 或源码文件不能更新用户已安装的旧版二进制。开发版需要重启；安装版需要使用包含这些改动的新包。此次修改不自动上传安装包或修改生产更新记录。

## 联调验收

1. `haolo.com` 登录和 `/api/sub2api/me/keys` 成功，后端下发新网关地址。
2. 启动旧会话后，模型地址为 `https://haolo.pro/v1`，账号和 Key 保持不变。
3. 使用用户原 Key 请求新域名 `/v1/models` 成功；各模型分组保持原样。
4. GPT 请求、外部模型请求和媒体请求不再访问旧域名。
5. 旧域名保持停用；不得为兼容旧客户端而擅自恢复。

相关测试：`test/haolo-gateway.test.mjs`、`test/app-server-client.test.mjs`、`test/youle-api-client.test.mjs`、`test/media-skill-contract.test.mjs`、`test/workflow-spec-runtime.test.mjs`。
