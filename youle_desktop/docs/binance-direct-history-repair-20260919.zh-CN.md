# 国内直连 500 与恢复后异常柱宽修复（2026-09-19）

## 结论与生效范围

本次确认了两个连续故障：生产行情网关公共缓存写入 Redis OOM，导致未命中缓存的历史请求返回 500；客户端首次历史失败后只恢复两根实时 K 线，并停止完整历史重试，初始视口又把两根柱子放大。响应正文生命周期的前一轮修复没有覆盖这两个根因。

行情网关修复已上线，Windows 开发版已使用最新源码重新打开。客户端图表修复尚未打包到安装版；源码按用户后续要求连同响应生命周期修复一起提交推送到 `dev`。M2-013 的多运营商与 72 小时长稳验收不在本次通过范围。

## 真实故障证据

- 保留系统代理，仅诊断请求显式 DIRECT；用现有登录态、正常票据流程和启用证书校验的真实请求复现。冷请求返回 500/`INTERNAL_ERROR`，随后同请求可内存 HIT 200。
- 在服务器回环地址运行与线上完全相同源码的隔离诊断实例，获得 `OOM command not allowed when used memory > 'maxmemory'`；不是凭状态码推测网络屏蔽。
- Redis 已使用 536707448 字节，最大 536870912 字节（512 MiB），策略 `noeviction`；当时 7025 个键中 6954 个是公共 REST 缓存。旧代码先把上游成功数据放进内存，再等待 Redis 写入；写入失败反而覆盖了成功结果。
- 客户端恢复路径调用仅取两根的实时刷新，并用 WS 活跃状态停止后续完整历史重试。`initialMarketLogicalRange` 又随两根数据缩小到约七个逻辑位置，产生截图中的超宽柱。

## 修复

1. 公共 REST 缓存独立限额：进程内序列化缓存 32 MiB/1024 条，共享 Redis 公共缓存逻辑预算 128 MiB/1024 条；Lua 原子淘汰仅触及公共缓存命名空间。Redis 仍为 `noeviction`，票据、permit、权重账本仍按原语义失败关闭。公共缓存不可用时按 miss 或进程缓存降级，不把上游成功结果变成 500。
2. 图表明确区分完整历史与实时少量数据。首轮失败后，即使有活跃 WS，仍强制补取 500 根并合并正在形成的 K 线；切换品种/周期后的迟到结果不能覆盖新图表。未完整恢复的 Binance 快照不持久化，旧的两根缓存需要完整刷新。
3. 初始视口固定常规 100 根、日线 180 根的空间；数据少时留白，避免放大柱宽。完整加载后的普通实时更新保留用户视口。
4. 新增开发参数 `--direct-network`，仅让这个开发进程的应用网络显式直连，不修改 Windows 系统代理。原生独立诊断和开发应用均能在 Codex 保持代理连接时复现国内链路。应用层 DIRECT 不能绕过操作系统 TUN；本次网卡检查和出口地区证据为当前国内 WLAN。

## 验收

| 范围 | 结果与证据（路径相对于 youle_desktop） |
| --- | --- |
| Windows 真实直连入口 | 自动选路、两个香港入口及原始入口共 10 项全部 200；7 次历史请求各 500 根，包含冷 MISS。`.cache/market-paths-report.json`；修复前对照 `.cache/market-paths-before-repair.json` |
| 完整客户端行情服务链 | SKHYNIX 合约、BTC 合约、BTC 现货各 500 根、非 stale、MISS 200；记录 `proxy:false` 和 TLS 验证。`.cache/direct-history-acceptance.json` |
| 授权实时行情 | 候选与切换验收收到真实带票据的合约行情帧，两个 ready 200，活动实例重启次数 0 |
| 网关回归 | 本地 37 项中 36 通过、1 项真实 Redis 条件测试跳过；服务器隔离 Redis 的相关 15/15 通过，补齐该条件测试。`.cache/gateway-cache-regression.log`、`.cache/gateway-repair-20260919/prepare.log` |
| 客户端定向回归 | 恢复、响应生命周期、路由及主进程接线 45/45；加强未完整历史持久化用例后 6/6 再次通过。`.cache/market-repair-final.log` |
| Electron 39 实际图表 | 加载失败→恢复 500 根→错误消失，两主题均约 10.36px 柱间距；用户视口保持；人为仅剩两根时也保持约 10.36px。`.cache/history-recovery-visual.json` 和 `history-{light,dark}-recovered.png` |
| 静态检查 | TypeScript、改动主进程模块语法、`git diff --check` 通过 |

图表验证运行实际工作区与 Lightweight Charts，使用隔离的合成行情夹具；真实网络验收另用上述生产数据，不把夹具截图作为生产行情证据。图表只变更数据恢复和逻辑视口，没有引入颜色或交互控件；亮暗主题错误态和恢复态均检查。

扩大回归存在 5 个既有失败：mention token、plus 菜单、VPVR 快照、价格锁定重绘、分屏品种/周期局部性源码断言。分别用 HEAD 的原始图表源码重新运行复现，见 `.cache/layout-head-baseline.log` 与 `.cache/chart-settings-head-baseline.log`。不能宣称仓库全套测试全绿。

## 生产变更与回退证据

- 边缘机 `8.219.93.44`，发布目录 `/opt/haolo/releases/gateway-cache-4e7170bdfe0d`。
- 活动容器 `haolo-binance-gateway-cache-4e7170bdfe0d`，回环公共/私有端口 `28787/28788`；镜像 `sha256:e59b782bb0bc201ea30d5e823094b212481b225f91485e7e1ed503f1c7677b1e`。
- 精确生产旧镜像上仅覆盖 `cache.mjs` 和新增 `public-rest-cache.mjs`；源码清单摘要 `4e7170bdfe0d0e76f8d0e6f792ae591268e17eacede380528244f08589f2c100`。
- 完整 HAProxy/活动状态和 Redis RDB 均有备份；RDB SHA256 `7996bf8b9a3cbd0fdace88a547fba0e995436537caa108af3e03d551d7f613b6`。只回收可重建的 `haolo:market:rest:(spot|futures):*`，没有全库清空或更改安全键。
- 两个公共 backend 与私有 backend 同步更新，保留 gzip、官网和 SSH 规则；发布锁、候选验收、独立 300 秒自动回退保护和外部验收完成后写入 accepted 回执。回退脚本与旧镜像保留，验收后解除定时回退。
- 旧容器 `haolo-binance-gateway-candidate-71758f4` 保留自然排空；最后检查仍有 71 个 WebSocket 客户端，退休待完成，禁止强杀现有连接或继续叠加发布。此处不是承诺零中断或 72 小时长稳通过。

## 再次复现

在 `youle_desktop` 运行开发版：

```powershell
node scripts/dev.mjs --direct-network
```

只读生产行情检查（读取现有会话，不打印票据或 token）：

```powershell
node scripts/smoke-binance-direct-history.mjs --live "--session-file=$env:APPDATA/haolo_desktop/haolo-session.json" --report=.cache/direct-history-acceptance.json
```

本次运行中的开发日志为 `.cache/dev-launch/20260919-130132-direct.stdout.log` 与对应 stderr；启动记录 DIRECT，实际行情路由记录 `egressRegion:CN`、`proxy:false`。

## 同日追加：本地、远端与线上一致性核对

按用户要求重新执行 `git fetch origin dev` 并直接读取当前活动容器，未使用发布时的回执代替现状。远端为 `https://github.com/cuirenjie/haolo_windows_web3.git`，本地 HEAD 和远端 `dev` 均为 `2cd82adf33d8d533b78687585698308cdeffcf6c`，但本地工作区含尚未提交的修复。

- **本地工作区与线上运行代码一致**：全部 13 个 `src` 文件和 `package.json` 共 14 个文件的 SHA256 逐字节相同，不只是忽略换行后一致。活动容器没有覆盖挂载，`docker diff` 没有该服务目录变更；生产修复源码及测试的 12 个发布清单文件也与本地和发布摘要全部一致。
- **Git 远端尚未同步**：运行源码差异只有 `src/cache.mjs` 的修改，以及远端缺少新增 `src/public-rest-cache.mjs`。本地另外有修改的 `test/binance-rest.test.mjs`、新增的 `test/public-rest-cache.test.mjs` 和修改的部署记录，均未提交推送。
- **路由确实使用修复实例**：活动镜像仍为 `sha256:e59b782bb0bc201ea30d5e823094b212481b225f91485e7e1ed503f1c7677b1e`，两个公共 HAProxy backend 指向 `28787`，私有 backend 指向 `28788`，两个 ready 均为 200，容器重启次数为 0。
- 审计完整哈希证据：`.cache/gateway-consistency-20260919.json`。本次只核对与记录，没有提交、推送、重新部署或重启。需要将上述修复提交推送到 `dev` 后，远端仓库才与本地/线上运行代码一致。

## 同日后续：源码提交与推送

用户在完成上述审计后明确要求提交推送。本次将网关缓存、客户端响应生命周期、完整历史恢复、开发直连诊断及配套测试/文档纳入同一提交，目标为原仓库 `origin/dev`。提交前 HEAD 与最新远端均为 `2cd82adf33d8d533b78687585698308cdeffcf6c`，没有待合并远端变更；历史压缩包、会话、凭证、临时日志和截图不纳入提交。提交前还更正独立直连烟测传给 governor 的参数名为 `timeoutMs`，使既定 30 秒请求预算实际生效；不改网关或客户端产品逻辑。

本次源码同步复用上述已完成的定向测试、真实 Redis 和 Electron 亮暗主题验收，提交号及最终远端状态由 Git 记录。安装包尚未生成或发布，服务器运行代码保持前次验收版本。
