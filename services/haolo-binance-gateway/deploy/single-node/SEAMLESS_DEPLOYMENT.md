# 行情/私有出口服务：无感发布准备状态

本服务部署于边缘机 `8.219.93.44`，同时提供行情 HTTP/WebSocket 与私有 CONNECT 代理。虽然源码属于桌面仓库，本次改造只涉及服务器，不构建或发布桌面安装包。

**本次代码尚未发布。不能称边缘服务器所有服务都已完成无感部署。** 官网和邀请中心的静态容器已迁移，不代表 `haolo-binance-gateway-1` 也已迁移。

已改：完整 HTTP handler/response 计数，接受中的升级鉴权计数，关闭时保留已有 WebSocket/CONNECT，待连接自然结束再关闭 upstream/cache。重复 close 调用等待同一完成结果；不会吞掉排空错误后提前关闭 Redis。Compose 的 24h 宽限不是部署方式，也不是允许超时强杀。

本地 28 项测试通过，包括真实本机 WebSocket ping/pong 和 CONNECT 双向字节在排空后继续传输；这些是隔离夹具，不是生产用户会话。

剩余上线要求：

- 制作与生产精确源码匹配的不可变镜像/版本证据，复核双实例 Redis 配额、permit、票据与上游连接容量。不得使用可变 tag 代替 image ID。
- 候选映射到未占用的仅回环端口，保持原 TLS、认证、域名和 Redis；不新增交易请求、不伪造生产用户凭证。
- 独立发布锁/监督与回滚，保留旧镜像和 Redis 一致性备份。HAProxy 完整配置防漂移、语法检查、原子切流及 graceful reload，保留现有 SSH 多路复用规则和其他域名。
- 等旧 HAProxy workers/连接退出才停止旧进程；超时记 retirement_pending，保留实例，阻止继续叠加版本。不能调用 compose restart/down 或清空 Redis。
- **先协调 watchdog**：当前 gateway-watchdog.sh 仍会在就绪失败时重启 gateway，甚至 Redis。它必须与发布共享排他锁、识别新活动 slot 和预期排空，才能启用生产发布；不能让旧 watchdog 误杀保留长连接的实例。
- 新实例完整版本、启动时间/稳定重启次数、两个 ready、实际授权业务路径、覆盖整个切换时间的 HAProxy 5xx/隧道异常都通过才算验收。旧版本没有新排空控制，首次迁移不可冒用新协议。
