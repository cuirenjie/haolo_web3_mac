# GPT-Image-2 系列客户端参数说明

> 资料来源：[aihubcc 客户 API 接入文档](https://oq2vmod9er.feishu.cn/docx/KUyVd0qmdotG0Hx2v5SczraGnbc)<br>
> 核对时间：2026-07-24<br>
> 用途：为 Haolo 客户端输入框设计模型参数面板。本文只整理接口文档已经声明的能力；未写入接口文档的参数不默认视为支持。

## 1. 模型 ID

接口文档中的准确模型 ID 带有连字符，客户端请求时应使用下表中的值，不要发送 `gpt-image2`、`gpt-image2-1K` 等展示写法。

| 产品展示名       | 请求中的 `model`   |
| ---------------- | ------------------ |
| GPT-Image-2      | `gpt-image-2`      |
| GPT-Image-2 1K   | `gpt-image-2-1k`   |
| GPT-Image-2 2K   | `gpt-image-2-2k`   |
| GPT-Image-2 3.5K | `gpt-image-2-3.5k` |

## 2. 能力总览

| 模型               | 调用方式                                                                     | 文生图 |         图生图 |                                最多参考图 | 输出尺寸/分辨率                                                           | 清晰度选项                              |      单次输出张数 |
| ------------------ | ---------------------------------------------------------------------------- | -----: | -------------: | ----------------------------------------: | ------------------------------------------------------------------------- | --------------------------------------- | ----------------: |
| `gpt-image-2`      | 同步；`/v1/images/generations`、`/v1/images/edits` 或 `/v1/chat/completions` |   支持 |           支持 | 文档只定义单个 `image`，客户端按 1 张限制 | `1024x1024`、`1536x1024`、`1024x1536`、`auto`；只控制画幅，不保证精确像素 | `auto`、`low`、`medium`、`high`         |             `1–4` |
| `gpt-image-2-1k`   | 异步 `POST /v1/videos`；中转改写上游模型为 `gpt-image-2-1k-async` |   支持 | 支持，多图融合 |                     6 张，合计不超过 5 MB | 约 1K；默认 `1024×1024`；通过 `aspect_ratio` 选画幅                        | 无 `quality` 字段，清晰度由 1K 档决定   | 1；文档未声明 `n` |
| `gpt-image-2-2k`   | 异步 `POST /v1/videos`，再轮询任务                               |   支持 | 支持，多图融合 |                     6 张，合计不超过 5 MB | 约 2K；默认 `2048×2048`；通过 `aspect_ratio` 选画幅                       | 无 `quality` 字段，清晰度由 2K 档决定   | 1；文档未声明 `n` |
| `gpt-image-2-3.5k` | 异步 `POST /v1/videos`，再轮询任务                               |   支持 | 支持，多图融合 |                     6 张，合计不超过 5 MB | 约 3.5K；默认 `2880×2880`；通过 `aspect_ratio` 选画幅                     | 无 `quality` 字段，清晰度由 3.5K 档决定 | 1；文档未声明 `n` |

注意：

- `gpt-image-2-3.5k` 的 1:1 默认分辨率为 `2880×2880`。其他画幅的实际像素没有在接口文档中逐项给出，客户端不应把所有比例都展示成固定 `2880×2880`。
- `gpt-image-2-1k`、`gpt-image-2-2k` 和 `gpt-image-2-3.5k` 的接口文档都没有 `quality`、`n` 参数。客户端不应为它们提交这两个字段。

## 3. `gpt-image-2`

### 3.1 支持的调用模式

| 能力               | 端点                          | Content-Type          | 说明                                                 |
| ------------------ | ----------------------------- | --------------------- | ---------------------------------------------------- |
| 文生图             | `POST /v1/images/generations` | `application/json`    | 标准同步生图                                         |
| 图生图/编辑        | `POST /v1/images/edits`       | `multipart/form-data` | 上传参考图文件并附提示词                             |
| Chat 文生图/图生图 | `POST /v1/chat/completions`   | `application/json`    | 通过 `messages` 生图；参考图必须转成 Base64 data URI |

### 3.2 文生图参数

| 参数              | 类型    | 必填 | 可选值/限制                                   | 建议默认值            | 客户端控件                           |
| ----------------- | ------- | ---: | --------------------------------------------- | --------------------- | ------------------------------------ |
| `model`           | string  |   否 | `gpt-image-2`                                 | `gpt-image-2`         | 由模型选择器写入                     |
| `prompt`          | string  |   是 | 图片描述                                      | 无                    | 提示词输入框                         |
| `n`               | integer |   否 | 接口支持 `1`、`2`、`3`、`4`；Haolo 固定提交 `1` | `1`                   | 不展示；客户端没有生成张数选项       |
| `size`            | string  |   否 | `1024x1024`、`1536x1024`、`1024x1536`、`auto` | `auto` 或 `1024x1024` | 图片尺寸/画幅选择器                  |
| `quality`         | string  |   否 | `auto`、`low`、`medium`、`high`               | `auto`                | 图片清晰度选择器                     |
| `response_format` | string  |   否 | `b64_json`、`url`                             | 文档默认 `b64_json`   | 建议作为内部配置，不必暴露给普通用户 |

`size` 是 best-effort 画幅控制：接口会按模型能力自动分配实际像素，约 150 万像素、长边约 1536，不承诺严格等于参数名称中的像素。需要更高分辨率时可选 `gpt-image-2-3.5k`；其 1:1 默认分辨率为 `2880×2880`。

清晰度的用户界面文案建议：

| UI 文案 | 请求值   |
| ------- | -------- |
| 自动    | `auto`   |
| 低      | `low`    |
| 标准    | `medium` |
| 高      | `high`   |

### 3.3 图生图参数

`/v1/images/edits` 在接口文档中明确展示的字段为：

| 参数     | 类型   | 必填 | 说明                                           |
| -------- | ------ | ---: | ---------------------------------------------- |
| `image`  | file   |   是 | 单张参考图；文档只定义单文件，没有声明多图数组 |
| `prompt` | string |   是 | 编辑要求                                       |
| `model`  | string |   是 | `gpt-image-2`                                  |

限制和提交要求：

- 客户端按最多 1 张参考图处理；这是基于文档仅定义单个 `image` 字段的保守限制，并非文档给出的显式“最大 1 张”声明。
- Haolo 客户端每次固定请求 1 张图片，不保留生成张数控件或可变张数参数。
- 上传参考图的长边必须不超过 2048 像素，超出会返回 HTTP 400。
- 必须让 HTTP 库自动生成 multipart boundary。不要手动填写 `Content-Type`，也不要手拼 multipart body。
- Chat 图生图只接受 `data:image/...;base64,...`，文档明确说明暂不支持直接传公网图片 URL。

### 3.4 响应

- 同步响应时间通常为 15–60 秒，客户端超时建议不低于 120 秒。
- 默认 `response_format=b64_json`，客户端需解码 Base64。
- 使用 `response_format=url` 时返回完整图片地址，可直接使用。

## 4. `gpt-image-2-1k`

### 4.1 请求参数

客户端端点：`POST /v1/videos`。中转保持公开模型 ID `gpt-image-2-1k` 兼容，但向 AIHubCC 提交时固定改写成 `gpt-image-2-1k-async`，返回 `task_id` 后轮询任务。

| 参数                   | 类型   | 必填 | 可选值/限制                                                                          | 建议默认值       |
| ---------------------- | ------ | ---: | ------------------------------------------------------------------------------------ | ---------------- |
| `model`                | string |   是 | 客户端固定 `gpt-image-2-1k`；中转改写为 `gpt-image-2-1k-async`                       | `gpt-image-2-1k` |
| `prompt`               | string |   是 | 图片描述                                                                             | 无               |
| `aspect_ratio`         | string |   否 | `1:1`、`16:9`、`9:16`、`4:3`、`3:4`、`3:2`、`2:3`、`5:4`、`4:5`                    | `1:1`            |
| `reference_image_urls` | array  |   否 | 参考图数组，最多 6 张，所有参考图合计不超过 5 MB                                     | 不传             |
| `image` / `image_url`  | string |   否 | 单张参考图时可作为 `reference_image_urls` 的别名                                     | 不传             |

能力规则：

- 不传参考图：文生图。
- 传 1–6 张参考图：图生图/多图融合。
- 文档没有声明 `quality`：不要提交。
- 文档没有声明 `n`：单次按 1 张结果处理。
- 客户端按异步接口支持的九个画幅展示，并直接提交 `aspect_ratio`；1K 不再提交 `size`。

### 4.2 异步响应

```text
POST /v1/videos
  → task_id
GET /v1/videos/{task_id}
  → queued → in_progress → completed
completed
  → video_url 为图片直链；缺失时可 GET /v1/videos/{task_id}/content
```

只以 `status=completed` 判定完成；`progress` 只用于展示。`success`、`succeeded`、`done` 或 `progress=100` 都不能提前结束轮询。

完成响应示例：

```json
{
  "status": "completed",
  "progress": 100,
  "video_url": "https://.../result.png"
}
```

## 5. `gpt-image-2-2k`

### 5.1 请求参数

客户端中转端点：`POST /v1/videos`。提交后返回任务 ID，客户端通过 `GET /v1/videos/{task_id}` 轮询任务状态，完成后从结果 URL 读取图片。

| 参数                          | 类型   | 必填 | 可选值/限制                                              | 建议默认值       |
| ----------------------------- | ------ | ---: | -------------------------------------------------------- | ---------------- |
| `model`                       | string |   是 | 固定 `gpt-image-2-2k`                                    | `gpt-image-2-2k` |
| `prompt`                      | string |   是 | 图片描述                                                 | 无               |
| `aspect_ratio`                | string |   否 | `1:1`、`16:9`、`9:16`、`4:3`、`3:2`、`5:4`，以及对应竖版 | `1:1`            |
| `image_url`                   | string |   否 | 单张参考图；公网 URL 或 `data:image/...;base64,...`      | 不传             |
| `reference_image_urls`        | array  |   否 | 多图融合，最多 6 张，所有参考图合计不超过 5 MB           | 不传             |
| `reference_images` / `images` | array  |   否 | `reference_image_urls` 的别名                            | 不传             |

关于 `aspect_ratio`：

- 文档明确列出：`1:1`、`16:9`、`9:16`、`4:3`、`3:2`、`5:4`。
- 文档只写“及竖版”，没有逐项列出剩余竖版值。通常对应 `3:4`、`2:3`、`4:5`，但这三个值应在上线前通过真实接口验证后再开放。
- 默认约 `2048×2048`；非 1:1 比例的实际像素没有在文档中逐项给出。

能力规则：

- 不传参考图：文生图。
- 传 1–6 张参考图：图生图/多图融合。
- 文档没有声明 `quality`：不要提交。
- 文档没有声明 `n`：单次按 1 张结果处理。

### 5.2 异步响应

```text
POST /v1/videos
  → task_id
GET /v1/videos/{task_id}
  → queued → in_progress → completed
completed
  → video_url 为 PNG/JPG 图片直链
```

多档生图章节的示例使用 `task_id`。客户端可在共享解析层容忍旧接口返回的 `id`，内部统一为一个任务 ID。

## 6. `gpt-image-2-3.5k`

### 6.1 请求参数

客户端中转端点：`POST /v1/videos`。提交后返回任务 ID，客户端通过 `GET /v1/videos/{task_id}` 轮询任务状态，完成后从结果 URL 读取图片。

| 参数                          | 类型   | 必填 | 可选值/限制                                              | 建议默认值         |
| ----------------------------- | ------ | ---: | -------------------------------------------------------- | ------------------ |
| `model`                       | string |   是 | 固定 `gpt-image-2-3.5k`                                  | `gpt-image-2-3.5k` |
| `prompt`                      | string |   是 | 图片描述                                                 | 无                 |
| `aspect_ratio`                | string |   否 | `1:1`、`16:9`、`9:16`、`4:3`、`3:2`、`5:4`，以及对应竖版 | `1:1`              |
| `image_url`                   | string |   否 | 单张参考图；公网 URL 或 `data:image/...;base64,...`      | 不传               |
| `reference_image_urls`        | array  |   否 | 多图融合，最多 6 张，所有参考图合计不超过 5 MB           | 不传               |
| `reference_images` / `images` | array  |   否 | `reference_image_urls` 的别名                            | 不传               |

能力规则：

- 不传参考图：文生图。
- 传 1–6 张参考图：图生图/多图融合。
- `aspect_ratio` 的选项和注意事项与 2K 相同。接口文档明确列出 `1:1`、`16:9`、`9:16`、`4:3`、`3:2`、`5:4`，其余只写“及竖版”；未明确列出的竖版值应在真实接口验证后再开放。
- 1:1 默认分辨率约为 `2880×2880`；非 1:1 比例的实际像素没有在文档中逐项给出。
- 文档没有声明 `quality`：不要提交。
- 文档没有声明 `n`：单次按 1 张结果处理。
- 按张固定计费，失败不计费。

### 6.2 异步响应

```text
POST /v1/videos
  → task_id
GET /v1/videos/{task_id}
  → queued → in_progress → completed
completed
  → video_url 为 PNG/JPG 图片直链
```

3.5K 与 2K 共用同一套异步任务流程。虽然结果字段名是 `video_url`，其内容在这个模型中是图片地址。

## 7. 客户端参数面板建议

| 控件             |         `gpt-image-2` | `gpt-image-2-1k` |    `gpt-image-2-2k` |  `gpt-image-2-3.5k` |
| ---------------- | --------------------: | ---------------: | ------------------: | ------------------: |
| 提示词           |                  显示 |             显示 |                显示 |                显示 |
| 清晰度           | 显示：自动/低/标准/高 |             隐藏 |                隐藏 |                隐藏 |
| 尺寸/画幅        |           显示 `size` | 显示 `aspect_ratio` | 显示 `aspect_ratio` | 显示 `aspect_ratio` |
| 输出张数         | 不展示，客户端默认 1 张 | 不展示，客户端默认 1 张 | 不展示，客户端默认 1 张 | 不展示，客户端默认 1 张 |
| 参考图上传       |       显示，最多 1 张 |  显示，最多 6 张 |     显示，最多 6 张 |     显示，最多 6 张 |
| 参考图总大小提示 |       长边 ≤2048 像素 |       合计 ≤5 MB |          合计 ≤5 MB |          合计 ≤5 MB |
| 提交状态         |              同步等待 |     异步任务进度 |        异步任务进度 |        异步任务进度 |

基础版把画幅比例映射为接口要求的 `size` 值；1K/2K/3.5K 则直接提交 `aspect_ratio`。Haolo 默认使用 `1:1`：

| 客户端显示 | 请求中的 `size` | 适用模型 |
| ---------- | --------------- | -------- |
| `1:1`      | `1024x1024`     | 基础版 |
| `3:2`      | `1536x1024`     | 基础版 |
| `2:3`      | `1024x1536`     | 基础版 |

发送前，客户端会从用户文字中识别明确的输出比例或像素尺寸，并归一为画幅比例。例如 `3:4`、`1536×2048` 都归一为 `3:4`。当前所选模型不支持该画幅时，客户端必须在任务创建前切换到实时目录中第一个支持该画幅的生图模型，并同时切换尺寸字段；例如基础版收到 `3:4` 请求时应切换到可用的 2K 或 3.5K 档。目录中没有支持型号时应阻止发送并明确提示，不能继续用不匹配的默认尺寸生成。

建议在客户端配置层为每个模型维护独立能力声明，不要仅按字段是否有值临时判断：

```ts
type ImageModelCapabilities = {
  model: string;
  mode: "sync" | "async";
  endpoint: "/v1/images/generations" | "/v1/videos";
  supportsTextToImage: boolean;
  supportsImageToImage: boolean;
  maxReferenceImages: number;
  maxOutputImages: number;
  sizeField: "size" | "aspect_ratio" | null;
  sizeOptions: string[];
  qualityOptions: string[];
  fixedResolution: string | null;
};
```

## 8. 接入时需要保留的兼容处理

1. 1K/2K/3.5K 多档生图的异步提交响应使用 `task_id`。若客户端还要兼容同端点的旧接口，可在解析层同时容忍 `id`，内部统一为一个任务 ID。
2. 异步图片完成后读取 `video_url`，不要因为字段名含 `video` 就按视频处理。
3. 仅 `gpt-image-2` 提交 `quality` 和固定的 `n=1`；客户端没有可变生成张数功能。
4. `gpt-image-2-1k`、`gpt-image-2-2k` 和 `gpt-image-2-3.5k` 使用 `aspect_ratio`；基础 `gpt-image-2` 使用 `size`。
5. 参考图字段按模型分别构造，不能把基础模型的 multipart `image` 直接复用到 1K/2K/3.5K JSON 请求。
6. 生产流量应继续走项目既定的集中中转链路；客户端和 Renderer 不保存或接收上游厂商密钥。
