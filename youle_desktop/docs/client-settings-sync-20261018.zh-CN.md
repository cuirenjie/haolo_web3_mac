# 账号设置双向同步（SETTINGS-SYNC-001）

2026-10-25 UI-CHART-SETTINGS-001：用户明确要求移动端复刻全部K线设置且双端全部同步。设置结构升级v8，保留原有字段，新增chart.verticalLocked及chart.drawingVisibility的aiHidden/manualHidden/dataHidden/ordersHidden/plansHidden，合计38个字段。层级显隐统一为账号设置，单个绘图对象隐藏仍按原会话本地保存；远端投影不产生本地编辑时钟、不更改图形或撤销栈。主图与分屏应用锁定状态，工具面板改变层级显隐同样进入同步队列。旧hideKlineAnnotations仅在新dataHidden缺失时投影兼容。恢复默认参与双向同步，重置视图是当前设备指令。原有仅本地锁定／会话层级显隐语义由本条取代。需要配套服务端六字段校验与新版Windows／移动端发布；单独提交或构建不等于生产生效。本次50项Windows回归及真实Windows→HTTP/PostgreSQL→Flutter→Windows的38字段往返通过；移动主记录见移动仓库verification/2026-10-25/chart-settings/README.md。

2026-10-18，Windows 0.1.181 当前源码。用户要求 Windows 与手机的指标参数、颜色、样式以及主题／通用设置双向同步。

`src/renderer/account-settings-sync.ts` 提供逐字段合并与按账号/API隔离的持久待发送队列；主进程 `client-settings-sync.mjs` 经原账号鉴权访问固定 `GET/PUT /api/mobile/v1/client-settings`，不向 renderer 暴露令牌。指标／图表编辑、主题／语言／字号／完成通知接入；主副图重算时保留视口，正在编辑的草稿只覆盖其明确修改字段。手机颜色恢复默认通过 `shared-indicator-defaults.ts` 保持两端主题默认色语义一致。

两端修改主动同步，前台五秒拉取、窗口聚焦／网络恢复立即刷新，失败退避重试。只有明确编辑会获得普通修改时间；旧本地数据只迁移一次且不能覆盖云端已有字段。读取／渲染不会回写成编辑，未知或另一端独有字段保留。

相关测试97项通过；最终同步专项8项、类型检查与Vite构建通过。真实隔离PostgreSQL往返验证：Windows写入指标周期／颜色／线宽／主题／语言／字号及图表外观，Flutter真实控制器接收并修改，再由Windows核对全部手机修改、默认色恢复及无关字段不变。测试入口 `scripts/verify-client-settings-roundtrip.mjs`，需先显式启动后端本机合成账号fixture；不会访问生产账号。

本次未提交、推送、打包安装器或发布0.1.181；保留工作区原有图表性能／画线等改动。生产接口与正式双端更新尚待上线，现有旧客户端不会自动获得源码修改。完整协议及发布边界见 haolo_front_web3 的 `youle_mas-dev/backend/docs/client-settings-sync.md`。
