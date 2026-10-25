# 快讯分类与悬浮顶部栏（2026-10-26）

状态：业务 API 已上线 ac2adbfa89c6b09cde7b783d35ba2a77c65c4227；客户端源码及开发构建已验证，本次未发布 Windows 安装包。

## 用户行为

- 快讯区域顶部整合页面入口、分类、日期及刷新。滚动时保持可见，加载和“暂无快讯”时日期、刷新仍在右上方。
- 分类固定顺序：精选（默认）、巨鲸、主力、市场、上新、美联储、特朗普。窄窗口横向滚动分类，日期与刷新不被挤走。
- 切换分类保留当前日期，清空旧列表及分页并回到顶部；刷新返回该分类最新内容。分页、自动刷新和重试均带上当前分类。
- 切换请求存在代次校验，较慢的旧分类响应不会覆盖新分类。旧 API 未回显分类时，非精选分类显示失败及重试，不能将精选内容伪装成分类结果。
- 简体、繁体、英文、韩文及明暗主题一并适配。原有文章、投票、分享及交易对功能保留。

## 接口

`GET /api/market-data/news` 增加 `category`：`featured / whales / main-force / market / listings / fed / trump`，默认 `featured`。与 `day`、`cursor`、`language` 组合，响应回显 `category`。

分类定义在 `src/shared/market-news-categories.mjs`，Renderer 和主进程共用；主进程验证参数并继续通过登录态请求业务 API。上游签名与凭证仍只在业务后端。

业务后端见规范仓库 `haolo_front_web3/youle_mas-dev/backend/docs/market-news-categories-20261026.md`。专题历史页面如遇上游忽略日期，后端会过滤日期外条目并保留继续翻页游标；客户端显示“加载更多”，仅在无条目且无游标时显示“暂无快讯”。

## 验证

均从 Windows 仓库根目录执行：

```powershell
node --test youle_desktop/test/market-news-api.test.mjs
pnpm --dir youle_desktop run typecheck
pnpm --dir youle_desktop run build
```

- 3 项客户端 API 测试、类型检查、Vite 构建通过。构建沿用现有大 bundle 提示；没有生成安装包。
- `scripts/market-news-categories-qa.mjs`：隐藏 Electron 窗口通过真实 preload IPC、YouleApiClient、回环 FastAPI 和真实分类服务，重放已获取的上游公共数据；7 组检查、26 张截图通过。
- 七类最新、历史、英文、分页均验证真实条目 ID；另验证日期保留、分页重置、迟到响应、旧 API 兼容保护及重试。
- 1500 / 1134 / 850 / 700 窗口宽度下，滚动 700px、加载中及空数据时顶部栏、页面入口、日期、刷新坐标相同，日历未越界。
- 四语言 × 两主题 × 两宽度以及原生按钮键盘激活通过。额外验证七类英文正文使用上游翻译。
- 原有 `scripts/market-news-visual-qa.mjs` 12 组回归、24 张截图通过，包含文章跳转、文字选择、投票、分享、日期和图表切换。
- 本地证据：`output/news-categories-20261026/categories-report.json`、`provider-verified.json`、`regression/visual-report.json` 及同目录截图。回环 API 启动辅助文件位于后端对应的 output 目录，只供本地 QA；用户鉴权和投票数据库由隔离替身提供，上游内容为真实公共数据捕获，不能据此宣称生产已上线。

`support/catalog.json` 四语言条目及生成的运行时已同步。工作区存在其他会话改动，提交或发布时需逐块核对，不得整体打包未审阅改动。

## 同日布局微调

按用户截图反馈，分类选中态去除下划线，仅用文字颜色及字重区分。分类栏与列表共用同一阅读列，标准宽度下整体左移 16px；首条快讯下移 12px，窄窗口保留 8px 顶部间距，左移在空间不足时自动归零。吸顶及右侧日期、刷新布局保持一致。

仅修改快讯 CSS 和四语言客服外观说明，未修改分类业务逻辑。原有视觉回归 12 项通过，Vite 构建通过；截图和布局测量保存于 `output/news-layout-polish-20261026/`。

## 分类加载失败修复与间距（同日）

- 根因是线上旧 API（9d55ef34）没有接收、转发或回显 category；新客户端因此正确拒绝把精选内容显示为美联储等分类。现已发布配套 API，保留客户端响应校验。
- 分类水平间距按三档响应布局从 12 / 10 / 8px 调整为 17 / 15 / 13px，各增加 5px。
- 使用现有登录态，在隔离的隐藏 Electron 窗口中经过真实 Renderer → preload IPC → YouleApiClient → haolo.com API 验收：七类各加载 30 条；美联储分页、刷新、北京时间日期筛选成功。测试只读，无投票或交易写入。
- 四个窗口宽度 × 明暗主题的间距实测均增加 5px，无下划线或整体横向溢出；滚动、空状态时日期/刷新位置稳定。Vite 构建成功，运行文件已生成。
- 证据：output/news-category-fix-20261026/live-report.json 及 11 张截图。后端发布、备份、稳定性观察和 Worker 保持记录位于规范后端仓库 docs/backend-news-category-release-20261026.md。
