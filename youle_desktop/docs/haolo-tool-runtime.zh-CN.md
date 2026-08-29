# Haolo 托管工具运行时

## 结论

Haolo 不修改 Codex CLI，也不把约 1 GB 的 Python、Node.js 和办公依赖直接塞进每次桌面安装包。桌面主进程在 Codex app-server 外管理一套独立、版本化的私有运行时，并只把运行时路径注入 Haolo 启动的任务进程。

运行时的使用优先级为：

1. Haolo 私有运行时；
2. 本机已有的 Codex 工作区运行时缓存；
3. 系统 PATH 中已有的工具。

该方案不会修改用户的系统 PATH，也不会替换或修补 `haolo_ai`/Codex CLI。

## 用户流程

- 应用启动时快速检查已安装运行时，不阻塞主窗口。
- 后台读取运行时清单；缺少或版本落后时支持断点续传。
- 后台准备失败后自动重试：30 秒起步按 2 倍退避，最长间隔 15 分钟；成功后重置重试周期。
- 下载完成后先校验归档大小和 SHA-256，再解压到临时目录。
- 拒绝路径穿越、符号链接和未知 TAR 条目；逐文件校验大小和 SHA-256。
- 完整校验通过后原子切换 `current.json`，失败时继续使用上一版本。
- 环境变化后只重启空闲 app-server；正在执行的任务不会被打断。
- 运行时在后台自动维护，不向普通设置页暴露诊断或修复入口。

私有文件默认存放在 Electron `userData/tool-runtimes` 下：

```text
tool-runtimes/
  current.json
  downloads/
  packages/
    <package-id>/
      <version>/
        .haolo-tool-runtime-ready.json
        haolo-runtime-package.json
        ...
```

## 发布清单

生产构建通过 `HAOLO_TOOL_RUNTIME_CATALOG_URL` 指向 HTTPS JSON 清单。开发和离线验收可通过 `HAOLO_TOOL_RUNTIME_CATALOG_PATH` 使用本地清单；本地包路径仅在这种显式模式下允许。

桌面端目前没有硬编码未经确认的生产下载地址。发布团队需要先上传运行时包，再发布清单，最后给生产构建配置清单 URL。

示例：

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-07-29T00:00:00.000Z",
  "packages": [
    {
      "id": "haolo-python",
      "displayName": "Haolo Python Runtime",
      "version": "3.13.5-1",
      "platform": "win32",
      "arch": "x64",
      "url": "https://download.haolo.com/tool-runtimes/win32/x64/haolo-python-3.13.5-1.tar.gz",
      "sizeBytes": 123456789,
      "uncompressedSizeBytes": 456789012,
      "sha256": "<64 位十六进制 SHA-256>",
      "preload": true
    }
  ]
}
```

要求：

- `schemaVersion` 必须为 `1`。
- 同一平台清单中每个 `id` 只能出现一次。
- `id` 和 `version` 只能使用安全的字母、数字、点、下划线、加号和连字符组合。
- 生产包必须使用 HTTPS 和不可变 URL。
- `sizeBytes` 与 `sha256` 都是必填项。
- 可将 Python、Node.js、办公依赖拆成多个包，以便分别升级和复用缓存。

## 包内清单

运行时包必须是 `.tar.gz`，归档根目录必须包含 `haolo-runtime-package.json`：

```json
{
  "schemaVersion": 1,
  "id": "haolo-python",
  "version": "3.13.5-1",
  "platform": "win32",
  "arch": "x64",
  "layout": {
    "executables": {
      "python": "python/python.exe",
      "uv": "bin/uv.exe"
    },
    "nodeModules": null,
    "binDirs": [
      "python",
      "bin"
    ]
  },
  "files": [
    {
      "path": "python/python.exe",
      "size": 103424,
      "sha256": "<文件 SHA-256>"
    }
  ]
}
```

`layout.executables` 支持 `python`、`node`、`rg`、`git`、`uv` 和 `pnpm`。`layout.nodeModules` 用于办公文档、表格、演示文稿等共享 Node.js 依赖。

包内不要包含符号链接、硬链接或设备文件。所有运行所需文件都应列入 `files`，发布前还应完成各第三方运行时和依赖的许可证审查。

## 注入的环境变量

发现相应能力后，Haolo 会在自身进程及其任务子进程中设置：

- `PYTHON`、`PYTHON_EXECUTABLE`、`PYTHONUTF8=1`
- `NODE`、`NODE_EXECUTABLE`
- `CODEX_WORKSPACE_DEPENDENCIES_NODE_MODULES`
- `RIPGREP_PATH`
- `GIT_EXECUTABLE`
- `UV`
- `PNPM`
- `HAOLO_TOOL_RUNTIME_ROOT`
- `HAOLO_TOOL_RUNTIME_SOURCE`

私有工具目录只会被前置到 Haolo 进程环境的 PATH，不写入注册表或用户/系统环境变量。

## 上线顺序与回滚

1. 分平台和架构构建运行时包。
2. 生成包内清单并逐文件计算 SHA-256。
3. 生成 `.tar.gz`，计算归档大小和 SHA-256。
4. 上传到不可变对象地址，验证 Range 请求和国内下载速度。
5. 发布引用新包的清单；清单必须最后更新。
6. 灰度配置 `HAOLO_TOOL_RUNTIME_CATALOG_URL`。
7. 观察下载失败率、校验失败率、安装耗时和任务工具缺失率。

回滚只需把清单重新指向已知正常的旧版本。客户端在新包完整校验和原子切换前会保留当前可用版本，并额外保留一个旧版本用于现场恢复。
