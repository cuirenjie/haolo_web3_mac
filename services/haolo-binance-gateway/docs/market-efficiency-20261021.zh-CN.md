# 2026-10-21 行情流量优化候选

后续发布状态：源码已分别推送，2026-10-21 12:32:58香港新连接已切至1fe4546并以10%配置accept；API／Worker也已发布。下文“未上线／未部署”为开发阶段历史记录，正式结果与实际混合流量收益见[生产灰度验收](market-efficiency-release-20261021.zh-CN.md)。持久采集器现已部署，旧连接继续自然排空，客户端安装包渠道未发布。

## 口径与持久采集

公共 REST/WS 的应用正文按 `node / tier / transport / market / family / codec / legacy` 归因；标签是有限集合，不记录用户、币种、URL、票据或凭证。`json_bytes_total` 是同一批响应若用原 JSON 所需的正文，`payload_bytes_total` 是实际发送正文，差值可用于统计编码与 304 节省。REST 分类包括 K 线、ticker、exchangeInfo、持仓量、比例和深度。

新增 `haolo_market_socket_bytes_total`：公共 WS 及私有 CONNECT 两个方向每秒读取 socket 累积计数，抓取和关闭时补采，不在每个行情事件执行额外 I/O。私有代理只计密文字节，`tier=unknown`；许可没有权威会员字段，不能猜为免费。WS socket 的 tier 为建立连接时的权益，应用正文 tier 为发送时的权益，跨到期边界可能短时不同。现有到期和连接租约继续生效。

三种字节口径不能相加：应用正文、socket、阿里云公网计费字节。socket 包括 WS 帧/压缩，但 HAProxy 后端 socket 不包括边缘 TLS/TCP 重传，REST socket/官网/CDN/部署下载也不在本指标中。需要用同一时间窗的 CDT 出站、服务器公网网卡和本指标交叉核对，剩余项明确为未归因，不能将进程计数当整月云账单。

`deploy/monitoring/` 提供独立 Prometheus 持久采集模板，本次未部署采集器。发布时按实际实例清单生成 `market-targets.json`：新、当前、仍在排空的 public/private 实例都要列入；直接访问每个实例的回环/可信内网 metrics，不能采负载均衡地址。每个实例固定唯一 `release_id`，不要随 active/draining 状态改标签。最后一次采集结束、连接归零且实例退出后再删除目标。旧实例不暴露新指标时告警并记录覆盖缺口，不能为补指标中断旧连接。

Prometheus 的数据目录使用持久卷并设置 `--storage.tsdb.retention.time=45d`；仅回环监听管理端口。metrics token 挂只读文件 `/run/secrets/haolo-market-metrics-token`，不要写进仓库或命令行。不同节点 token 不同时复制 job 并使用各自的凭证文件。示例端口不能当作已核验的生产映射；发布前使用实际 `docker inspect`/代理布局生成目标。运行 `promtool check config`、`promtool check rules`，确认所有目标 `up=1` 后才开始计算覆盖率。

查询最近 15 天正文 GB（GB=10^9 字节）与原 JSON GB：

```promql
sum by (node,tier,transport,market,family,codec,legacy) (increase(haolo_market_traffic_payload_bytes_total[15d])) / 1e9
sum by (node,tier,transport,market,family,codec,legacy) (increase(haolo_market_traffic_json_bytes_total[15d])) / 1e9
```

先按实例 `increase` 再 `sum`，保留重启归零处理。监控增长量会按采样区间外推，首次采集前、采集缺失期间和最后采集后的短尾部无法精确补回；日报须附目标覆盖率与缺口，CDT 用量以云账单为准。依据：[采集配置](https://prometheus.io/docs/prometheus/latest/configuration/configuration/)、[increase 语义](https://prometheus.io/docs/prometheus/latest/querying/functions/#increase)。

## 无损编码与客户端

源码默认 `HAOLO_MARKET_COMPACT_ENABLED=true`、`HAOLO_MARKET_COMPACT_PERCENT=100`。只有票据明确声明 hmc1 的客户端启用，旧客户端/旧票据仍用 JSON；已有环境显式 false 仍优先，发布时需核验配置。灰度比例按用户稳定散列，0 或 enabled=false 只影响后续票据，不切断已有连接。协议字段表保持 hmc1 原定义，未知字段/事件与不更短的帧回退 JSON。保留每条事件、价格/数量原字符串、成交序号及布尔/null/缺省字段，不改变发送节奏、不增加批处理等待。

桌面公共 REST 新增服务层请求合并：仅相同规范化 URL、freshness、demand 合并，独立返回深拷贝。单个调用方取消不取消其它读者；全部退出才取消共享 I/O。缓存到期后带 ETag 重新验证；304 必须匹配本地尚未超过 stale 上限的正文，保留服务端真实 fetched-at。深度/逐笔成交同步起点仍取完整正文。原 TTL、上游退避、数据陈旧检查保持。

移动端增加 hmc1 解码，主图与自选共用原 MarketFeed 路径；业务 API 仅转发客户端明确支持的能力，旧移动端仍只协商 JSON。行情目录和匿名快照使用有界内存 ETag（最多 16 项，每项不超过 512 KiB，最多 60 秒）；304 本身不续本地保留期限，缺时间头保留原 fetchedAt。private/no-store 响应不进入该缓存，会员快照保持服务器既有私有缓存语义。相同快照并发请求按会话版本、URL、鉴权选项和 deadline 合并，401 重试留在共享请求内部；不合并交易、分析创建、票据或其它写操作。

移动免费/会员线路开关仍由后端既有配置控制，有效体验会员保持 paid；本轮协议优化不等于 ENS 节点已部署。灰度验收应包含两个节点、断网恢复、后台/前台、账号切换、权益到期、历史补洞与旧版本兼容；本地实测结果另见任务验收记录。

## 本机验证（2026-10-21，未上线）

| 范围 | 结果与证据 |
| --- | --- |
| 网关完整测试 | 95 项：92 通过、3 项真实 Redis 条件跳过；未配置 REDIS_TEST_URL。最终串行运行无失败，见 `youle_desktop/output/market-gateway-serial-final-20261021.log`。此前与 Flutter 全量回归并行时一项 3.5 秒连接恢复检查超时，保留原日志；隔离重跑与最终全套通过，未放宽超时或改断言。 |
| 桌面完整测试 | 4,679 项全部通过；TypeScript 检查通过。最初系统 python 指向不可用别名导致 72 项媒体工具测试失败，使用已安装 Python 后整套通过，两个日志均保留。 |
| 业务后端 | 行情路由/HTTP/历史/目录 65 项，冷却/目录/准入/隔离/后台预算 47 项，合计 112 通过。routing 模块及新增测试 Ruff 通过；api.py 的 10 项历史 lint 与改动前 HEAD 对照完全相同，未扩大为全文件整理。 |
| 移动完整测试 | 3,725 通过、5 条件跳过、18 失败。仅将本任务的三个既有源码文件暂时换回 HEAD 在同一工作目录重跑：同样的 18 项全部复现；随后逐字节恢复候选并校验哈希。失败涉及旧图标/弹窗/分析 fixture/启动设置同步，不改截图基准和断言。 |
| 移动专项 | 最终 84 通过、1 个需现场捕获目录的用例跳过。覆盖主图/自选真实 WS、14 组 Node 生成的跨语言 fixture、旧 JSON、异常帧、100 并发、401 共享重试、304、no-store、三语/两主题/Android 与 iOS 组件。静态分析通过；原非 ASCII 路径的 Flutter LSP 启动失败，使用同一目录的 ASCII 盘符映射通过。iOS 原生设备未实测。 |
| 持久采集模板 | YAML 与目标 JSON 解析通过；本机无 promtool，正式接入采集器时还须执行其配置与规则校验。未启动或部署采集器。 |

独立进程压测命令：`node services/haolo-binance-gateway/scripts/benchmark-market-codec-isolated.mjs 320 json`，分别替换为 hmc1 与 1,000 客户端。每连接 500 条合成 aggTrade，网关与模拟客户端分开计 CPU；原同进程压测也保留原始证据，不能把其全部解码 CPU 计为网关开销。

| 独立进程指标 | 320 连接 JSON → hmc1 | 1,000 连接 JSON → hmc1 |
| --- | --- | --- |
| 收到消息 / 顺序或价格错误 | 各 160,000 / 0 | 各 500,000 / 0 |
| socket 字节（十进制 MB） | 30.735 → 23.047（减少 25.0%） | 96.019 → 72.031（减少 25.0%） |
| P95 延迟 | 16.09 → 16.89 ms | 23.76 → 25.31 ms |
| P99 延迟 | 29.16 → 28.40 ms | 30.43 → 32.43 ms |
| 网关 CPU 时间 | 5,547 → 5,562 ms | 11,625 → 12,406 ms（+6.7%） |
| 网关 RSS | 84.44 → 83.94 MB | 115.68 → 114.79 MB |

共 132 万条分进程消息全部收到，顺序/价格校验零错误。精简编码有客户端重建对象成本，并非零 CPU 代价；本机共享负载、Windows 定时器和模拟器会影响测量，不能据此保证 WAN 或高峰容量。约 25% 是这组合成 aggTrade 的 socket 字节节省，不是所有事件或整张 CDT 账单的降幅；实际比例由行情结构、客户端升级覆盖率和其它公网业务决定。原始结果在 `youle_desktop/output/market-isolated-benchmark-20261021.json`。

生产发布建议先显式设 `HAOLO_MARKET_COMPACT_PERCENT=10`，观察 P95/P99、CPU、事件积压、断线/补洞、错误率及实际节省后逐步提高；回退设 0 即可让新票据回到 JSON，不断开既有连接。本次只完成代码和本机验证，未提交、推送或部署。

移动端已在规范共享工作区执行 `Run-Mobile.ps1 -Offline`，Release x64 构建、保留数据覆盖安装并启动；构建前后全部 Dart 源码哈希一致。11:58 设备 APK 与本地 APK SHA256 一致：`0c8435a9ac71727149cf331aecb5efc98634d5c2ddb97771bd050597e6ddcae7`，App 前台且进程存在，所检索的进程致命异常日志为空。此为本机安装验收，不是生产更新渠道发布或原生界面全面验收。共享仓库其它会话的账户页／图片工具等后续独立修改不纳入上述测试结论，保留其变更。
