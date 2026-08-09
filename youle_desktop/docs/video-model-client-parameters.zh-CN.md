# Seedance / Grok / Omni 视频模型客户端参数说明

> 资料来源：[aihubcc 客户 API 接入文档](https://oq2vmod9er.feishu.cn/docx/KUyVd0qmdotG0Hx2v5SczraGnbc)<br>
> 核对时间：2026-08-06<br>
> 用途：为 Haolo 客户端输入框设计视频模型参数面板。本文只整理接口文档已经声明的能力；未写入接口文档的参数不默认视为支持。

## 1. 模型 ID

请求中的 `model` 应使用接口文档中的准确大小写和连字符：

| 产品展示名                     | 请求中的 `model`                 |
| ------------------------------ | -------------------------------- |
| Seedance 2.0 480p              | `Seedance-2.0-480p`              |
| Seedance 2.0 720p              | `Seedance-2.0-720p`              |
| Seedance 2.0 1080p             | `Seedance-2.0-1080p`             |
| Seedance 2.0 Mini 480p         | `Seedance-2.0-mini-480p`         |
| Seedance 2.0 Mini 720p         | `Seedance-2.0-mini-720p`         |
| Grok Imagine Video 1.5         | `grok-imagine-video-1.5`         |
| Omni Fast 无水印               | `omni-fast-no-water`             |
| Omni Fast V2V 无水印           | `omni-fast-v2v-no-water`         |

客户端必须原样提交业务模型 ID；统一中转根据该 ID 选择 AIHubCC 账号池并完成上游模型映射。Grok 1.5 使用直接异步端点 `/v1/videos`，其他兼容模型可继续使用中转的旧媒体任务端点。

各模型使用文档中的顶层参数：Seedance 的档位已经编码在模型 ID 中，不再额外发送 `resolution`；Grok 1.5 使用顶层 `image`、`seconds`、`aspect_ratio` 和 `resolution`；Omni 根据业务模型分别发送 `images` 或 `videos`。

`aihubcc/grok-video-3.5` 不作为客户端模型选择器中的独立选项，但现在保留为 Buming 的 Grok 同模型供应商兜底 ID。普通任务的单图链为：

```text
AIHubCC grok-imagine-video-1.5
→ Buming aihubcc/grok-video-3.5
→ AIHubCC omni-fast-no-water
```

视频专家锁定用户选中的模型；选中 AIHubCC Grok 时以 `--exact-model --provider-fallback-only` 最多只转一次 Buming Grok，不再转 Omni。两种路径都必须等脚本返回 `pending=false + state=failed + safe_to_resubmit=true + fallback_allowed=true`，无结构 502、断线或读取超时不得触发切换。

## 2. 当前临时限制

接口文档在 Seedance 2.0 章节顶部标注了正在生效的临时维护限制。客户端在该提示撤除前，应采用“当前有效上限”，不要直接采用协议设计上限。

| Seedance 能力          |           协议设计上限 |           当前有效上限 |
| ---------------------- | ---------------------: | ---------------------: |
| 参考图片               |                   9 张 |                   4 张 |
| 参考视频               |                   3 个 |                   3 个 |
| 参考音频               |                   3 个 |                   1 个 |
| 全能参考               | 9 图 + 3 视频 + 3 音频 | 4 图 + 3 视频 + 1 音频 |
| `@人物` 名称一致性绑定 |                   支持 |               暂不可用 |

文档明确写明维护期间 480p、720p 全档位的文生视频、图生视频、参考视频、单音频和首尾帧能力正常。`Seedance-2.0-1080p` 仍列在可用模型表中，但临时提示没有单独确认 1080p 的维护状态；正式开放前建议做一次真实接口预检。

## 3. 能力总览

六个模型均为异步任务：

> Haolo 客户端使用统一 AIHubCC 中转。2026-08-06 已确认 Grok 1.5 的直接异步路由为 `POST /v1/videos`，轮询路由为 `GET /v1/videos/{task_id}`。

```text
POST /v1/videos
  → 返回 task_id
GET /v1/videos/{task_id}
  → 轮询状态
完成
  → 从 video_url 或 data[0].url 读取视频地址
```

| 模型                             | 清晰度             | 文生视频 |                           图生视频 |              视频参考/V2V |                     音频参考 | 时长选项                                          | 画幅/尺寸选项                               | 单次输出 |
| -------------------------------- | ------------------ | -------: | ---------------------------------: | ------------------------: | ---------------------------: | ------------------------------------------------- | ------------------------------------------- | -------: |
| `Seedance-2.0-480p`              | 480p               |     支持 | 支持；当前最多 4 图，协议上限 9 图 |   支持参考视频，最多 3 个 | 当前最多 1 个，协议上限 3 个 | `4–15` 秒任意整数                                 | `16:9`、`9:16`、`1:1`、`21:9`、`3:4`、`4:3` |        1 |
| `Seedance-2.0-720p`              | 720p               |     支持 | 支持；当前最多 4 图，协议上限 9 图 |   支持参考视频，最多 3 个 | 当前最多 1 个，协议上限 3 个 | `4–15` 秒任意整数                                 | `16:9`、`9:16`、`1:1`、`21:9`、`3:4`、`4:3` |        1 |
| `Seedance-2.0-1080p`             | 1080p              |     支持 | 支持；当前最多 4 图，协议上限 9 图 |   支持参考视频，最多 3 个 | 当前最多 1 个，协议上限 3 个 | `4–15` 秒任意整数                                 | `16:9`、`9:16`、`1:1`、`21:9`、`3:4`、`4:3` |        1 |
| `Seedance-2.0-mini-480p`         | 480p               |     支持 | 支持；当前最多 4 图，协议上限 9 图 |   支持参考视频，最多 3 个 | 当前最多 1 个，协议上限 3 个 | `4–15` 秒任意整数                                 | `16:9`、`9:16`、`1:1`、`21:9`、`3:4`、`4:3` |        1 |
| `Seedance-2.0-mini-720p`         | 720p               |     支持 | 支持；当前最多 4 图，协议上限 9 图 |   支持参考视频，最多 3 个 | 当前最多 1 个，协议上限 3 个 | `4–15` 秒任意整数                                 | `16:9`、`9:16`、`1:1`、`21:9`、`3:4`、`4:3` |        1 |
| `grok-imagine-video-1.5`         | 480p / 720p        |     支持 | 支持；可传 1 张 URL 或 Base64 Data URI |                 不支持 |                       不支持 | `1–15` 秒任意整数                                 | 7 个 `aspect_ratio` 值，见第 5 节           |        1 |
| `omni-fast-no-water`             | 文档未给分辨率选项 |     支持 |                    支持；最多 5 图 |                不支持 V2V |                       不支持 | 接受 `seconds`/`duration`，但当前固定输出约 10 秒 | `16:9`、`9:16`                              |        1 |
| `omni-fast-v2v-no-water`         | 文档未给分辨率选项 |   不支持 |                             不支持 | 支持 V2V，最多 2 个源视频 |                       不支持 | 接受 `seconds`/`duration`，但当前固定输出约 10 秒 | `16:9`、`9:16`                              |        1 |

共同规则：

- 六个模型都没有 `quality` 参数，清晰度由模型名决定。
- 八个模型都没有 `n` 参数，客户端应按单次生成 1 个视频处理。
- 失败不计费。两个 Seedance Mini 模型按 `duration` 秒数计费；三个标准 Seedance、Grok 1.5 和 Omni 模型按次计费。

## 4. Seedance 2.0 五个模型档

五个 Seedance 模型只在系列、清晰度和定位上不同，请求字段完全一致。Mini 480p 按输出时长每秒扣 2 积分，Mini 720p 按输出时长每秒扣 3 积分。

| 模型                 | 定位                          | 文档给出的输出说明                             |
| -------------------- | ----------------------------- | ---------------------------------------------- |
| `Seedance-2.0-480p`  | 经济档、标准质量、成本最低    | 480p 随画幅变化；文档示例中 4:3 约为 `752×560` |
| `Seedance-2.0-720p`  | 高清标准、质量更佳            | 720p 的 16:9 约为 `1280×720`                   |
| `Seedance-2.0-1080p` | 超清标准、最高画质、大屏/商用 | 文档没有逐画幅列出准确像素矩阵                 |
| `Seedance-2.0-mini-480p` | Mini 经济档、低成本快速迭代 | 480p |
| `Seedance-2.0-mini-720p` | Mini 高清档、质量与成本平衡 | 720p |

文档在“480p / 720p 档规格”中声明：

- 输出格式为 H.264、24 fps。
- 包含 AAC 立体声同步音轨。
- 输出无水印。

该规格标题只明确覆盖 480p 和 720p；1080p 的编码、帧率和准确像素没有在该段单独声明。

### 4.1 核心参数

端点：`POST /v1/videos`。

| 参数                    | 类型         | 必填 | 可选值/限制                                                                 | 建议默认值         | 客户端控件           |
| ----------------------- | ------------ | ---: | --------------------------------------------------------------------------- | ------------------ | -------------------- |
| `model`                 | string       |   是 | 五个模型之一                                                                | 用户当前选择的模型 | 模型选择器           |
| `prompt`                | string       |   是 | 不超过 5000 字符；可包含 `@image1`、`@video1`、`@audio1` 等素材引用         | 无                 | 提示词输入框         |
| `aspect_ratio`          | string       |   否 | `16:9`、`9:16`、`1:1`、`21:9`、`3:4`、`4:3`                                 | `16:9`             | 画幅选择器           |
| `duration`              | integer      |   否 | `4–15` 中的任意整数                                                         | 建议 `5`           | 时长滑块或整数选择器 |
| `image_url`             | string       |   否 | 旧版单张主图字段；公网 URL、Base64 data URI 或 multipart 文件               | 不传               | 仅兼容旧请求         |
| `reference_image_urls`  | array        |   否 | 推荐的参考图字段；协议上限 9，当前上限 4                                    | 不传               | 多图上传             |
| `reference_image_names` | array        |   否 | 与参考图同序的人物/主体名称；别名 `reference_names`                         | 不传               | 当前维护期间隐藏     |
| `reference_image_roles` | array        |   否 | 与参考图同序；`subject` 或 `background`；别名 `reference_roles`             | 不传               | 高级选项             |
| `reference_videos`      | array/string |   否 | 最多 3 个；单个别名 `reference_video`，数组别名 `extra_videos`              | 不传               | 参考视频上传         |
| `reference_audios`      | array/string |   否 | 协议上限 3，当前上限 1；别名 `reference_audio`、`audio_url`、`extra_audios` | 不传               | 参考音频上传         |
| `first_image_url`       | string       |   否 | 首帧；必须和 `last_image_url` 成对出现                                      | 不传               | 首尾帧模式           |
| `last_image_url`        | string       |   否 | 尾帧；必须和 `first_image_url` 成对出现                                     | 不传               | 首尾帧模式           |

`reference_image_urls` 的兼容别名：

- `reference_images`
- `extra_images`
- `input_reference`
- 单张可用 `reference_image`

新客户端建议统一使用 `reference_images` 对象数组：

```json
[
  {
    "url": "https://cdn.example.com/person.jpg",
    "name": "人物A",
    "role": "subject"
  },
  {
    "url": "https://cdn.example.com/background.jpg",
    "role": "background"
  }
]
```

维护期间 `name`/`@人物` 绑定暂不可用，客户端可以保留数据结构，但不应向用户承诺名称绑定生效。`role=subject/background` 未被临时提示标记为停用。

### 4.2 生成模式

Seedance 不接收单独的 `mode` 参数。服务端根据提交的素材字段自动识别模式。

| 模式     | 最少必传                                        | 素材规则                                                  | 当前客户端限制                  |
| -------- | ----------------------------------------------- | --------------------------------------------------------- | ------------------------------- |
| 文生视频 | `prompt`                                        | 不传任何素材                                              | 可用                            |
| 图生视频 | `prompt` + 至少 1 张图                          | 只传图片，不传参考视频；协议支持 1–9 图                   | 当前最多 4 图                   |
| 全能参考 | `prompt` + 至少 1 张图                          | 在图片基础上叠加参考视频/音频；不能只传视频或音频         | 当前最多 4 图 + 3 视频 + 1 音频 |
| 首尾帧   | `prompt` + `first_image_url` + `last_image_url` | 固定 2 张，必须成对；额外的 `reference_image_urls` 不生效 | 固定首帧和尾帧各 1 张           |

素材引用：

- 图片：`@image1` … `@image9`
- 视频：`@video1` … `@video3`
- 音频：`@audio1` … `@audio3`

音频或视频参考必须至少搭配 1 张主图。只传参考视频或音频而不传图片会失败。

### 4.3 输入素材限制

| 素材     | 格式/来源                                                   |                   数量 | 其他限制                                                    |
| -------- | ----------------------------------------------------------- | ---------------------: | ----------------------------------------------------------- |
| 参考图   | JPEG、PNG、WEBP；公网 HTTP(S)、Base64 data URI 或 multipart | 协议最多 9，当前最多 4 | 长边 ≤4000 px；每边 ≥300 px；宽高比 `0.4–2.5`；单张 ≤30 MB  |
| 参考视频 | MP4、MOV；公网 URL 或 Base64                                |                 最多 3 | 单个 2–15 秒；24–60 fps；单个 ≤50 MB；多个视频总时长 ≤15 秒 |
| 参考音频 | MP3，兼容 WAV、M4A 等；公网 URL 或 Base64                   | 协议最多 3，当前最多 1 | 必须搭配至少 1 张主图；文档未声明单个音频大小上限           |
| 首尾帧   | 公网 URL 或 Base64                                          |              固定 2 张 | 必须同时提交首帧与尾帧；不接受额外参考图                    |

multipart 多图注意事项：

- 文档说明 multipart 上传多张图时只会识别 1 张。
- 多图应使用 JSON，把公网 URL 或 Base64 data URI 放入数组。
- multipart 适合单图，字段名为 `image`。

### 4.4 画幅选项

| UI 文案  | `aspect_ratio` |
| -------- | -------------- |
| 横屏     | `16:9`         |
| 竖屏     | `9:16`         |
| 方形     | `1:1`          |
| 超宽屏   | `21:9`         |
| 竖向 3:4 | `3:4`          |
| 横向 4:3 | `4:3`          |

### 4.5 异步响应与错误

任务完成后从轮询响应的 `video_url` 读取视频直链。

接口文档列出的主要错误：

| 错误码              | 含义                                         |
| ------------------- | -------------------------------------------- |
| `400017`            | 模型、时长、画幅或参考图规格不合法           |
| `400018`            | `prompt` 超过 5000 字符                      |
| `500341`            | 参考视频格式、时长、帧率、大小或总时长不合法 |
| `GENERATION_FAILED` | 生成失败、素材不适合或内容策略拦截           |
| `TIMEOUT`           | 生成超时，可稍后重试                         |
| `NO_ACCOUNT`        | 服务繁忙，暂无可用通道                       |
| `PROMPT_BLOCKED`    | 提示词被内容策略拒绝                         |

## 5. `grok-imagine-video-1.5`

该模型同时支持文生视频和单图图生视频。不传 `image` 为文生视频，传 `image` 为图生视频。

### 5.1 请求参数

端点：`POST /v1/videos`。

| 参数           | 类型   | 必填 | 可选值/限制                                      | 默认值 | 客户端控件       |
| -------------- | ------ | ---: | ------------------------------------------------ | ------ | ---------------- |
| `model`        | string |   是 | 固定 `grok-imagine-video-1.5`                    | 无     | 模型选择器写入   |
| `prompt`       | string |   是 | 画面和运动描述                                   | 无     | 提示词输入框     |
| `image`        | string |   否 | 公网 URL 或 Base64 Data URI；JPG、PNG、WebP      | 不传   | 单图上传         |
| `seconds`      | string |   否 | `"1"` 至 `"15"`                              | `"6"` | 时长选择器       |
| `aspect_ratio` | string |   否 | `16:9`、`9:16`、`1:1`、`4:3`、`3:4`、`2:3`、`3:2` | 无     | 画幅选择器       |
| `resolution`   | string |   否 | `480p`、`720p`（仅小写）                         | `720p` | 分辨率选择器     |

参考图规则：

- 只能传 1 张。
- 必须是公网可直接访问的图片直链。
- 也可提交带 `data:` 前缀的完整 Base64 Data URI。
- 内网地址、需要登录或带页面鉴权的 URL 会失败。

### 5.2 画幅与分辨率选项

客户端提交 `aspect_ratio` 和 `resolution`，不再提交旧的 `size` 字段：

| 控件 | 可选值 |
| ---- | ------ |
| 画幅 | `16:9`、`9:16`、`1:1`、`4:3`、`3:4`、`2:3`、`3:2` |
| 分辨率 | `480p`、`720p` |

客户端按字符串提交 `seconds`，范围为 `1–15`；轮询只以 `status=completed` 判断完成，`progress` 仅供展示。

### 5.3 时长选项

客户端提供 1 至 15 秒的整数选项，默认 6 秒，不再展示 16 秒和 20 秒。

### 5.4 异步响应

```text
POST /v1/videos
  → {"task_id":"task_xxx","status":"queued"}
GET /v1/videos/task_xxx
  → completed 后读取 video_url
```

客户端超时建议不低于 300 秒，轮询间隔建议 3–5 秒。

### 5.5 Buming Grok 同模型兜底契约

Buming 兼容路由使用公共 ID `aihubcc/grok-video-3.5`，请求体与 AIHubCC Grok 1.5 不同：

```json
{
  "model": "aihubcc/grok-video-3.5",
  "prompt": "...",
  "params": {
    "images": ["https://cdn.example.com/first-frame.png"],
    "aspect_ratio": "9:16",
    "resolution": "720p",
    "duration": 6
  }
}
```

约束：

- 必须且只能有一张公网参考图；
- `duration` 为 JSON 整数，范围 1–15 秒；
- `aspect_ratio` 支持 `16:9`、`9:16`、`1:1`、`3:2`、`2:3`；
- `resolution` 支持 `720p`、`480p`；
- 每次供应商回退使用新的 request ID，并沿用相同 conversation ID。

## 6. `omni-fast-no-water`

该模型支持无水印文生视频和图生视频，不支持 V2V。无水印结果会经过自动清洗，完成前可能比普通模型多一个 `processing` 状态，因此耗时略长。

### 6.1 请求参数

端点：`POST /v1/videos`，支持 JSON 或 multipart。

| 参数                   | 类型           | 必填 | 可选值/限制                                             | 默认值 |
| ---------------------- | -------------- | ---: | ------------------------------------------------------- | ------ |
| `model`                | string         |   是 | 固定 `omni-fast-no-water`                               | 无     |
| `prompt`               | string         |   是 | 视频描述提示词                                          | 无     |
| `aspect_ratio`         | string         |   否 | `16:9`、`9:16`                                          | `16:9` |
| `seconds` / `duration` | string/integer |   否 | 接口接受该字段，但当前 Gemini 固定输出约 10 秒          | `10`   |
| `image_url`            | string         |   否 | 单张参考图；公网 URL 或 Base64 data URI                 | 不传   |
| `first_image_url`      | string         |   否 | 首帧参考图 URL                                          | 不传   |
| `last_image_url`       | string         |   否 | 尾帧参考图 URL                                          | 不传   |
| `images`               | string[]       |   否 | 多参考图，最多 5 张，每张 ≤8 MB                         | 不传   |
| `input_reference`      | file           |   否 | multipart 参考图文件，可重复上传，最多 5 张，每张 ≤8 MB | 不传   |

能力判断：

- 不传任何参考图：文生视频。
- 传 `image_url`、`images` 或 `input_reference`：图生视频。
- 最多 5 张参考图，每张不超过 8 MB。
- 文档没有给出可选输出分辨率，也没有 `quality` 参数。
- 虽然接受 `seconds`/`duration`，当前输出仍固定约 10 秒。客户端建议显示“约 10 秒（固定）”，不要提供无效的自由时长滑块。

## 7. `omni-fast-v2v-no-water`

该模型只支持无水印视频转视频（V2V），最多接收 2 个源视频，不支持纯文生视频或图生视频。

### 7.1 请求参数

端点：`POST /v1/videos`，支持 JSON 或 multipart。

| 参数                   | 类型           |     必填 | 可选值/限制                                    | 默认值 |
| ---------------------- | -------------- | -------: | ---------------------------------------------- | ------ |
| `model`                | string         |       是 | 固定 `omni-fast-v2v-no-water`                  | 无     |
| `prompt`               | string         |       是 | 转换要求/视频描述                              | 无     |
| `aspect_ratio`         | string         |       否 | `16:9`、`9:16`                                 | `16:9` |
| `seconds` / `duration` | string/integer |       否 | 接口接受该字段，但当前 Gemini 固定输出约 10 秒 | `10`   |
| `video`                | string         | 条件必填 | 第一个源视频 URL                               | 不传   |
| `video_url`            | string         | 条件必填 | 单源视频 URL，或双源时作为另一个视频字段       | 不传   |
| `videos`               | string[]       | 条件必填 | 多源视频数组，最多 2 个                        | 不传   |
| `input_video`          | file           | 条件必填 | multipart 第一个源视频                         | 不传   |
| `input_video2`         | file           |       否 | multipart 第二个源视频                         | 不传   |

源视频限制：

- 最少 1 个、最多 2 个。
- 每个源视频不超过 8 MB。
- 源视频分辨率不超过 `1920×1080`。
- multipart 传两个视频时，可使用 `input_video` + `input_video2`，也可以用同一个视频字段名重复上传两个文件。
- JSON 传多个视频时优先使用 `videos` 数组。

客户端应隐藏参考图片、参考音频和清晰度控件。时长建议显示为固定约 10 秒。

## 8. Omni 异步响应

两个无水印 Omni 模型使用相同任务流程：

```text
POST /v1/videos
  → task_id
GET /v1/videos/{task_id}
  → queued / in_progress / processing / completed / failed
completed
  → data[0].url
```

也可以通过以下端点下载成片：

```text
GET /v1/videos/{task_id}/content
```

客户端轮询逻辑必须把 `processing` 当作未完成的正常中间状态，不能误判为失败。

## 9. 客户端参数面板建议

Haolo 的 Grok 1.5 时长选择器提供 1–15 秒整数并默认 6 秒；客户端不再展示 16 秒或 20 秒。Seedance 为 4–15 秒，两个 Omni 固定为 10 秒。

| 控件      | Seedance 五个模型档（含 Mini） |          Grok 1.5 |                 Omni 无水印 |             Omni V2V 无水印 |
| --------- | ---------------------------: | ------------------: | --------------------------: | --------------------------: |
| 提示词    |                         显示 |                显示 |                        显示 |                        显示 |
| 清晰度    |             隐藏，由模型决定 | `480p` / `720p` |                        隐藏 |                        隐藏 |
| 时长      |              显示：4–15 整数 | 显示：1–15 整数，默认 6 |          显示只读“约 10 秒” |          显示只读“约 10 秒” |
| 画幅/尺寸 |        `aspect_ratio` 六选一 | `aspect_ratio` 七选一 |       `aspect_ratio` 二选一 |       `aspect_ratio` 二选一 |
| 参考图    | 当前最多 4 图；协议最多 9 图 |     可选，最多 1 图 |                   最多 5 图 |                        隐藏 |
| 首尾帧    |               显示为独立模式 |                隐藏 |                      可显示 |                        隐藏 |
| 参考视频  |                    最多 3 个 |                隐藏 |                        隐藏 |                必填，1–2 个 |
| 参考音频  | 当前最多 1 个；协议最多 3 个 |                隐藏 |                        隐藏 |                        隐藏 |
| 输出数量  |                 隐藏，固定 1 |        隐藏，固定 1 |                隐藏，固定 1 |                隐藏，固定 1 |
| 任务状态  |                     异步进度 |            异步进度 | 异步进度，兼容 `processing` | 异步进度，兼容 `processing` |

## 10. 推荐的能力配置结构

客户端不应在提交时临时猜测字段，应为每个模型维护独立能力声明：

```ts
type VideoModelCapabilities = {
  model: string;
  resolutionLabel: string;
  supportsTextToVideo: boolean;
  supportsImageToVideo: boolean;
  supportsVideoReference: boolean;
  supportsVideoToVideo: boolean;
  supportsAudioReference: boolean;
  supportsFirstLastFrame: boolean;
  maxReferenceImages: number;
  maxReferenceVideos: number;
  maxReferenceAudios: number;
  durationField: "duration" | "seconds" | null;
  durationOptions: number[];
  aspectField: "aspect_ratio" | "size" | null;
  aspectOptions: string[];
  pollingResultField: "video_url" | "data[0].url";
};
```

Seedance 的临时维护限制应来自可更新的服务端能力配置，而不是永久硬编码为 4 图/1 音频。文档撤除维护提示并完成接口验证后，客户端再恢复到 9 图/3 音频。

## 11. 接入时需要保留的兼容处理

1. 所有模型统一走异步任务，不要保持长连接等待生成完成。
2. Seedance 完成后读取 `video_url`；Omni 完成后读取 `data[0].url`，并支持 `/content` 下载。
3. Omni 无水印模型轮询时允许额外的 `processing` 状态。
4. Seedance 的 `duration` 必须是 `4–15` 的整数；Grok 的 `seconds` 只能是 5 个枚举值；Omni 时长当前固定约 10 秒。
5. Seedance 多图不要用 multipart 重复上传，应转为 JSON URL/Base64 数组；multipart 仅按单图处理。
6. Grok 1.5 的参考图必须是公网直链，不要直接复用 Seedance 的 Base64/multipart 上传逻辑。
7. `omni-fast-v2v-no-water` 最多 2 个源视频，每个 ≤8 MB、分辨率 ≤`1920×1080`。
8. 六个模型均不提交 `quality` 或 `n`。
9. 生产流量继续走项目既定的集中中转链路；客户端和 Renderer 不保存或接收上游厂商密钥。
