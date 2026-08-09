# P0 简化版：用户A 与 用户B桌面智能体通信方案

## 1. 目标

P0 只实现一条最小闭环：

```text
用户A本人 -> 用户B桌面智能体
```

用户A可以向用户B的桌面智能体发送自然语言消息。用户B的桌面智能体收到后，自行判断这是一条普通聊天、问答咨询，还是任务请求。

如果是普通聊天或问答，用户B桌面智能体直接回复。

如果是任务请求，用户B桌面智能体根据本机权限策略决定是否自动执行、弹窗确认、拒绝或请求澄清。执行过程和结果通过频道消息回写给用户A。

P0 不做复杂模型，不新增 `direct-desktop-agent` 接口，不新增 `channel_actors` / `channel_tasks` 表。

## 2. 核心原则

```text
用户A只表达意图
用户B桌面智能体判断是不是任务
用户B桌面端权限策略决定能不能执行
后端只负责存消息和推事件
```

也就是说：

```text
用户A不需要选择“聊天 / 派任务”
```

用户A只需要选择：

```text
发送给：用户B的桌面智能体
```

是否是任务，由用户B桌面智能体判断。

## 3. 为什么不新增接口

当前 P0 不需要新增：

```http
POST /api/channels/direct-desktop-agent
```

直接复用现有接口：

```http
GET  /api/channels/users/search
POST /api/channels
GET  /api/channels/{channel_id}/participants
POST /api/channels/{channel_id}/messages
GET  /api/channels/events/stream
POST /api/channels/{channel_id}/agent-claims
```

这样改动最小：

```text
不用新增 direct agent API
不用新增 channel_actors 表
不用新增 channel_tasks 表
不用大改频道模型
```

其中 `POST /api/channels/{channel_id}/agent-claims` 不是新的聊天发送接口，而是“桌面智能体领取处理权”的幂等锁接口，用来解决同一台电脑开多个客户端、SSE 重连、历史消息补扫导致重复回复的问题。

P0 先用 `channel_messages.payload_json` 承载临时语义：

```text
source
target
intent
task_status
reply_to_message_id
```

未来如果验证成功，再把这些 payload 语义升级成正式表字段或正式表结构。

## 4. 当前接口如何支撑 P0

### 4.1 搜索用户B

用户A搜索用户B：

```http
GET /api/channels/users/search?q=mnm0756@gmail.com
```

搜索规则：

```text
只支持精确匹配 email 或 citizen_id
不做模糊搜索
不在输入过程中自动搜索
用户输入完成后点击搜索或按 Enter 触发
```

返回：

```json
{
  "items": [
    {
      "id": "user_b_id",
      "citizen_id": 11001,
      "nickname": "用户mnm0756",
      "email_masked": "mn***@gmail.com",
      "avatar_url": null
    }
  ]
}
```

后端返回的邮箱必须是脱敏字段 `email_masked`，不能直接返回完整邮箱。

### 4.2 创建或进入频道

继续使用现有频道创建接口：

```http
POST /api/channels
```

请求：

```json
{
  "channel_type": "group",
  "name": "mnm0756 的桌面智能体",
  "participant_user_ids": ["user_b_id"]
}
```

后端现有逻辑需要保证：

```text
创建者用户A自动加入频道
participant_user_ids 中的用户B加入频道
```

频道实际成员：

```text
用户A
用户B
```

但 P0 的产品语义是：

```text
用户A正在和用户B的桌面智能体对话
```

### 4.2.1 获取频道参与者信息

桌面端进入频道后需要拉取参与者信息：

```http
GET /api/channels/{channel_id}/participants
```

返回字段需要包含：

```json
{
  "items": [
    {
      "id": "participant_id",
      "user_id": "user_b_id",
      "display_name": "mnm0756",
      "nickname": "mnm0756",
      "citizen_id": 11001,
      "email_masked": "mn***@gmail.com",
      "avatar_url": null,
      "role": "member",
      "status": "active"
    }
  ]
}
```

这些字段用于：

```text
频道标题
成员列表
消息发送方名称
输入框“发送给谁”
左侧频道列表预览
```

消息发送方名称不能从频道标题里猜。例如频道标题是“caixikai02 的桌面智能体”，不代表所有消息都来自 caixikai02。必须用 `sender_user_id` 去参与者列表里找真实显示名。

### 4.3 用户A给用户B桌面智能体发消息

继续使用现有消息接口：

```http
POST /api/channels/{channel_id}/messages
```

请求：

```json
{
  "client_message_id": "channel-client-xxx",
  "message_type": "text",
  "text": "你帮我看一下这个项目为什么启动失败",
  "payload": {
    "source": {
      "type": "human"
    },
    "target": {
      "type": "user_desktop_agent",
      "user_id": "user_b_id"
    }
  }
}
```

后端只需要：

```text
保存 text
保存 payload_json
广播 message_added
```

后端不需要在 P0 判断这是不是任务。

### 4.4 消息记录如何区分人和桌面智能体

P0 暂时不引入 `channel_actors` 表，但消息里必须明确两层身份：

```text
sender_user_id：这条消息归属于哪个真实用户账号
sender_type：这个账号下的哪个角色在发言
payload.source：发送角色的补充语义
payload.target：目标角色的补充语义
```

当前约定：

```text
sender_type = user
表示该账号本人发出的消息

sender_type = user_desktop_agent
表示该账号的桌面智能体发出的消息
```

示例：

```json
{
  "sender_user_id": "user_b_id",
  "sender_type": "user_desktop_agent",
  "text": "你好，我是 mnm0756 的桌面智能体。",
  "payload": {
    "source": {
      "type": "user_desktop_agent",
      "user_id": "user_b_id"
    },
    "target": {
      "type": "human",
      "user_id": "user_a_id"
    },
    "reply_to_message_id": "original_message_id"
  }
}
```

含义是：

```text
这条消息属于用户B账号
但发言角色不是用户B本人
而是用户B的桌面智能体
```

### 4.5 已实现 API 明细

本节记录当前后端已经实现并被桌面端使用的 Channels API。所有接口都需要登录态，桌面端通过现有用户系统携带认证信息。

接口基础路径：

```http
/api/channels
```

#### 4.5.1 搜索可邀请用户

```http
GET /api/channels/users/search?q={email_or_citizen_id}&channel_id={channel_id}&limit=20
```

用途：

```text
通过 email 或 citizen_id 精确查找另一个账号，用于邀请联系人或创建频道。
```

查询参数：

| 参数 | 必填 | 中文说明 |
| --- | --- | --- |
| `q` | 是 | 搜索值，只支持完整 email 或完整 citizen_id |
| `channel_id` | 否 | 如果是在已有频道里邀请成员，需要校验当前用户是该频道 owner/admin |
| `limit` | 否 | 返回数量，默认 20，最大 50 |

匹配规则：

```text
如果 q 包含 @：按 lab_users.email 精确匹配，忽略大小写
如果 q 全是数字：按 lab_users.citizen_id 精确匹配
其他输入：直接返回空数组
只返回 status=active 的用户
```

返回：

```json
{
  "items": [
    {
      "id": "user_b_id",
      "citizen_id": 11001,
      "nickname": "mnm0756",
      "email_masked": "mn***@gmail.com",
      "avatar_url": null
    }
  ]
}
```

字段说明：

| 字段 | 中文说明 |
| --- | --- |
| `id` | 用户 UUID，后续创建频道或邀请时使用 |
| `citizen_id` | 用户的 citizen_id |
| `nickname` | 用户昵称 |
| `email_masked` | 脱敏邮箱，不能返回完整邮箱 |
| `avatar_url` | 用户头像 |

#### 4.5.2 获取频道列表

```http
GET /api/channels?limit=50&type=group
```

用途：

```text
获取当前登录用户参与的频道列表，用于桌面端左侧频道列表。
```

查询参数：

| 参数 | 必填 | 中文说明 |
| --- | --- | --- |
| `limit` | 否 | 返回数量，默认 50，最大 100 |
| `type` | 否 | 频道类型，可选 `group` 或 `direct` |

返回：

```json
{
  "items": [
    {
      "id": "channel_id",
      "channel_type": "group",
      "name": "mnm0756 的桌面智能体",
      "description": null,
      "avatar_url": null,
      "status": "active",
      "created_by_user_id": "user_a_id",
      "created_at": "2026-06-05T10:00:00Z",
      "updated_at": "2026-06-05T10:00:00Z",
      "last_message_at": "2026-06-05T10:01:00Z",
      "last_message": {
        "id": "message_id",
        "sender_type": "user_desktop_agent",
        "sender_user_id": "user_b_id",
        "client_message_id": "desktop-agent-reply:user_b_id:request_message_id",
        "message_type": "text",
        "text": "你好，我是 mnm0756 的桌面智能体。",
        "payload": {},
        "attachments": [],
        "created_at": "2026-06-05T10:01:00Z"
      },
      "unread_count": 0,
      "participants_preview": []
    }
  ],
  "next_cursor": null
}
```

桌面端使用重点：

```text
左侧频道列表使用 name / participants_preview / last_message 展示
last_message 如果 sender_type=user_desktop_agent，预览可显示“桌面智能体：xxx”
```

#### 4.5.3 创建频道

```http
POST /api/channels
```

用途：

```text
创建包含当前用户和目标用户的频道。P0 里用它创建“和某人的桌面智能体对话”的频道。
```

请求：

```json
{
  "channel_type": "group",
  "name": "mnm0756 的桌面智能体",
  "description": null,
  "participant_user_ids": ["user_b_id"]
}
```

请求字段说明：

| 字段 | 中文说明 |
| --- | --- |
| `channel_type` | 频道类型，P0 使用 `group` |
| `name` | 频道名称，最长 120 字符 |
| `description` | 频道描述，可为空 |
| `participant_user_ids` | 要邀请的用户 UUID 列表，不需要包含当前用户，后端会自动加入创建者 |

返回：

```json
{
  "channel": {
    "id": "channel_id",
    "channel_type": "group",
    "name": "mnm0756 的桌面智能体",
    "description": null,
    "avatar_url": null,
    "status": "active",
    "created_by_user_id": "user_a_id",
    "created_at": "2026-06-05T10:00:00Z",
    "updated_at": "2026-06-05T10:00:00Z",
    "last_message_at": null
  }
}
```

后端行为：

```text
创建者自动成为 owner
participant_user_ids 中的用户成为 member
创建成功后向所有成员写入 channel_created 事件
```

#### 4.5.4 获取单个频道

```http
GET /api/channels/{channel_id}
```

用途：

```text
获取频道基础信息。当前用户必须是频道 active participant。
```

返回：

```json
{
  "id": "channel_id",
  "channel_type": "group",
  "name": "mnm0756 的桌面智能体",
  "description": null,
  "avatar_url": null,
  "status": "active",
  "created_by_user_id": "user_a_id",
  "created_at": "2026-06-05T10:00:00Z",
  "updated_at": "2026-06-05T10:00:00Z",
  "last_message_at": null
}
```

#### 4.5.5 更新频道

```http
PATCH /api/channels/{channel_id}
```

用途：

```text
更新频道名称、描述或头像。当前用户必须是 owner/admin。
```

请求：

```json
{
  "name": "新的频道名称",
  "description": "频道描述",
  "avatar_url": "https://example.com/avatar.png"
}
```

返回：

```json
{
  "channel": {
    "id": "channel_id",
    "name": "新的频道名称",
    "description": "频道描述",
    "avatar_url": "https://example.com/avatar.png"
  }
}
```

事件：

```text
channel_updated
```

#### 4.5.6 获取频道参与者

```http
GET /api/channels/{channel_id}/participants
```

用途：

```text
获取频道参与者，并补充用户显示字段。桌面端用它修正消息发送方名称和输入框目标名称。
```

返回：

```json
{
  "items": [
    {
      "id": "participant_id",
      "channel_id": "channel_id",
      "participant_type": "user",
      "user_id": "user_b_id",
      "agent_id": null,
      "display_name": "mnm0756",
      "nickname": "mnm0756",
      "citizen_id": 11001,
      "email_masked": "mn***@gmail.com",
      "avatar_url": null,
      "role": "member",
      "status": "active",
      "joined_at": "2026-06-05T10:00:00Z",
      "left_at": null,
      "last_active_at": null
    }
  ]
}
```

字段说明：

| 字段 | 中文说明 |
| --- | --- |
| `participant_type` | 参与者类型，P0 主要是 `user` |
| `user_id` | 真实用户账号 ID |
| `display_name` | 优先展示名 |
| `nickname` | 用户昵称 |
| `citizen_id` | 用户 citizen_id |
| `email_masked` | 脱敏邮箱 |
| `role` | `owner` / `admin` / `member` / `agent` |
| `status` | `active` / `left` / `removed` |

桌面端必须：

```text
用 sender_user_id 匹配 participants.user_id
再用 display_name / nickname / email_masked / citizen_id 生成消息发送方名称
不能从频道名猜发送方
```

#### 4.5.7 添加频道参与者

```http
POST /api/channels/{channel_id}/participants
```

用途：

```text
向已有频道邀请一个用户。当前用户必须是 owner/admin。
```

请求：

```json
{
  "participant_type": "user",
  "user_id": "user_b_id",
  "role": "member"
}
```

返回：

```json
{
  "participant": {
    "id": "participant_id",
    "channel_id": "channel_id",
    "participant_type": "user",
    "user_id": "user_b_id",
    "role": "member",
    "status": "active"
  }
}
```

事件：

```text
participant_added
```

#### 4.5.8 更新频道参与者角色

```http
PATCH /api/channels/{channel_id}/participants/{participant_id}
```

用途：

```text
更新参与者角色。当前用户必须是 owner/admin。
```

请求：

```json
{
  "role": "admin"
}
```

返回：

```json
{
  "participant": {
    "id": "participant_id",
    "role": "admin"
  }
}
```

事件：

```text
participant_updated
```

#### 4.5.9 删除频道参与者

```http
DELETE /api/channels/{channel_id}/participants/{participant_id}
```

用途：

```text
从频道移除参与者。当前用户必须是 owner/admin。
```

返回：

```json
{
  "participant": {
    "id": "participant_id",
    "status": "removed",
    "left_at": "2026-06-05T10:10:00Z"
  }
}
```

事件：

```text
participant_removed
```

#### 4.5.10 离开频道

```http
POST /api/channels/{channel_id}/leave
```

用途：

```text
当前用户主动离开频道。
```

返回：

```json
{
  "participant": {
    "id": "participant_id",
    "status": "left",
    "left_at": "2026-06-05T10:10:00Z"
  }
}
```

事件：

```text
participant_removed
```

#### 4.5.11 获取频道消息

```http
GET /api/channels/{channel_id}/messages?limit=50&before={message_id}
```

用途：

```text
拉取频道历史消息。用户B桌面端启动后也用它补扫未处理的 target=user_desktop_agent 消息。
```

查询参数：

| 参数 | 必填 | 中文说明 |
| --- | --- | --- |
| `limit` | 否 | 返回数量，默认 50，最大 100 |
| `before` | 否 | 分页游标，传某条 message_id 后返回更早消息 |

返回：

```json
{
  "items": [
    {
      "id": "message_id",
      "channel_id": "channel_id",
      "sender_participant_id": "participant_id",
      "sender_type": "user",
      "sender_user_id": "user_a_id",
      "sender_agent_id": null,
      "client_message_id": "channel-client-xxx",
      "message_type": "text",
      "text": "你帮我看一下这个项目为什么启动失败",
      "payload": {
        "source": {
          "type": "human"
        },
        "target": {
          "type": "user_desktop_agent",
          "user_id": "user_b_id"
        }
      },
      "attachments": [],
      "created_at": "2026-06-05T10:01:00Z",
      "edited_at": null,
      "deleted_at": null
    }
  ],
  "next_cursor": null
}
```

字段说明：

| 字段 | 中文说明 |
| --- | --- |
| `sender_type` | 发言角色，`user` 或 `user_desktop_agent` |
| `sender_user_id` | 消息归属的真实用户账号 |
| `client_message_id` | 客户端生成的幂等 ID，用于本地消息和远端消息合并 |
| `payload.source` | 发送方语义 |
| `payload.target` | 目标方语义 |
| `attachments` | 附件列表 |

#### 4.5.12 发送频道消息

```http
POST /api/channels/{channel_id}/messages
```

用途：

```text
发送普通频道消息、发给桌面智能体的请求、桌面智能体回复、任务状态消息。
```

用户A 调用用户B桌面智能体的请求：

```json
{
  "client_message_id": "channel-client-xxx",
  "message_type": "text",
  "text": "你帮我看一下这个项目为什么启动失败",
  "payload": {
    "source": {
      "type": "human",
      "user_id": "user_a_id"
    },
    "target": {
      "type": "user_desktop_agent",
      "user_id": "user_b_id"
    }
  },
  "attachments": []
}
```

用户B桌面智能体回复：

```json
{
  "client_message_id": "desktop-agent-reply:user_b_id:request_message_id",
  "message_type": "text",
  "text": "我看到了你的请求，可以继续帮你处理。",
  "payload": {
    "source": {
      "type": "user_desktop_agent",
      "user_id": "user_b_id"
    },
    "target": {
      "type": "human",
      "user_id": "user_a_id"
    },
    "intent": "chat",
    "reply_to_message_id": "request_message_id"
  },
  "attachments": []
}
```

返回：

```json
{
  "message": {
    "id": "message_id",
    "channel_id": "channel_id",
    "sender_participant_id": "participant_id",
    "sender_type": "user_desktop_agent",
    "sender_user_id": "user_b_id",
    "sender_agent_id": null,
    "client_message_id": "desktop-agent-reply:user_b_id:request_message_id",
    "message_type": "text",
    "text": "我看到了你的请求，可以继续帮你处理。",
    "payload": {
      "source": {
        "type": "user_desktop_agent",
        "user_id": "user_b_id"
      },
      "target": {
        "type": "human",
        "user_id": "user_a_id"
      },
      "intent": "chat",
      "reply_to_message_id": "request_message_id"
    },
    "attachments": [],
    "created_at": "2026-06-05T10:02:00Z",
    "edited_at": null,
    "deleted_at": null
  }
}
```

后端行为：

```text
payload.source.type=user_desktop_agent -> sender_type=user_desktop_agent
否则 sender_type=user
同一个 channel_id + client_message_id 重复发送时，返回已有消息，不再新建
保存成功后广播 message_added
如果 sender_type=user_desktop_agent 且 payload.reply_to_message_id 存在，会更新对应 agent claim 为 completed 或 failed
```

#### 4.5.13 桌面智能体领取消息处理权

```http
POST /api/channels/{channel_id}/agent-claims
```

用途：

```text
桌面智能体处理目标消息前先领取处理权，防止多个客户端或重连导致重复处理。
```

请求：

```json
{
  "message_id": "request_message_id"
}
```

返回，首次领取成功：

```json
{
  "claim": {
    "id": "claim_id",
    "channel_id": "channel_id",
    "message_id": "request_message_id",
    "agent_owner_user_id": "user_b_id",
    "status": "claimed",
    "reply_message_id": null,
    "error_message": null,
    "claimed_at": "2026-06-05T10:01:01Z",
    "updated_at": "2026-06-05T10:01:01Z",
    "completed_at": null,
    "claimed": true
  }
}
```

返回，已经被同一用户桌面智能体领取过：

```json
{
  "claim": {
    "id": "claim_id",
    "channel_id": "channel_id",
    "message_id": "request_message_id",
    "agent_owner_user_id": "user_b_id",
    "status": "completed",
    "reply_message_id": "reply_message_id",
    "error_message": null,
    "claimed_at": "2026-06-05T10:01:01Z",
    "updated_at": "2026-06-05T10:02:00Z",
    "completed_at": "2026-06-05T10:02:00Z",
    "claimed": false
  }
}
```

关键规则：

```text
message_id + agent_owner_user_id 唯一
message.sender_user_id == 当前登录用户id 时不允许 claim
只有 claimed=true 的客户端可以调用本地桌面智能体处理
claimed=false 时必须直接跳过
```

#### 4.5.14 更新频道消息

```http
PATCH /api/channels/{channel_id}/messages/{message_id}
```

用途：

```text
编辑自己发送的频道消息。
```

请求：

```json
{
  "text": "更新后的内容",
  "payload": {
    "source": {
      "type": "human"
    }
  }
}
```

返回：

```json
{
  "message": {
    "id": "message_id",
    "text": "更新后的内容",
    "payload": {
      "source": {
        "type": "human"
      }
    },
    "edited_at": "2026-06-05T10:03:00Z"
  }
}
```

事件：

```text
message_updated
```

#### 4.5.15 删除频道消息

```http
DELETE /api/channels/{channel_id}/messages/{message_id}
```

用途：

```text
删除自己发送的频道消息。当前实现是软删除。
```

返回：

```json
{
  "message": {
    "id": "message_id",
    "deleted_at": "2026-06-05T10:04:00Z"
  }
}
```

事件：

```text
message_deleted
```

#### 4.5.16 标记频道已读

```http
POST /api/channels/{channel_id}/read
```

用途：

```text
记录当前用户读到哪条消息，用于未读数。
```

请求：

```json
{
  "last_read_message_id": "message_id"
}
```

返回：

```json
{
  "channel_id": "channel_id",
  "user_id": "user_id",
  "last_read_message_id": "message_id"
}
```

事件：

```text
read_state_updated
```

#### 4.5.17 频道实时事件流

```http
GET /api/channels/events/stream?last_event_id={event_id}
```

用途：

```text
SSE 实时推送频道事件。桌面端用它接收新消息、参与者变化、频道更新和桌面智能体请求。
```

请求头：

```http
Last-Event-ID: 123
```

也可以用查询参数：

```http
?last_event_id=123
```

SSE 格式：

```text
id: 124
event: message_added
data: {"event_id":124,"event_type":"message_added","channel_id":"channel_id","payload":{"message":{}},"created_at":"2026-06-05T10:05:00Z"}
```

事件 data 结构：

```json
{
  "event_id": 124,
  "event_type": "message_added",
  "channel_id": "channel_id",
  "payload": {
    "message": {}
  },
  "created_at": "2026-06-05T10:05:00Z"
}
```

当前主要事件：

| 事件 | 中文说明 |
| --- | --- |
| `channel_created` | 新频道创建 |
| `channel_updated` | 频道信息更新 |
| `participant_added` | 参与者加入 |
| `participant_updated` | 参与者角色更新 |
| `participant_removed` | 参与者离开或被移除 |
| `message_added` | 新消息 |
| `message_updated` | 消息编辑 |
| `message_deleted` | 消息删除 |
| `read_state_updated` | 已读状态更新 |

连接规则：

```text
后端会先 replay last_event_id 之后的历史事件
之后进入实时等待
每 15 秒没有事件时发送 : ping 保活
桌面端断线重连时应带上最后收到的 event_id
```

### 4.6 API 错误与权限约定

常见错误：

| HTTP 状态 | 中文说明 |
| --- | --- |
| `400` | 请求参数非法，例如 channel_type 无效、target user_id 非法、claim 自己发出的消息 |
| `403` | 当前用户不是频道成员，或没有 owner/admin 权限 |
| `404` | 频道、消息或用户不存在 |
| `409` | claim 并发冲突 |

权限规则：

```text
读取频道/消息/参与者：必须是 active participant
更新频道/添加成员/更新成员/移除成员：必须是 owner/admin
编辑/删除消息：必须是消息发送者本人
claim 桌面智能体消息：当前用户必须是频道成员，且不能 claim 自己发出的消息
```

## 5. 用户B桌面端如何识别消息

用户B桌面端通过 SSE 收到：

```text
message_added
```

拿到消息后判断：

```text
message.payload.target.type == "user_desktop_agent"
message.payload.target.user_id == 当前登录用户id
message.sender_user_id != 当前登录用户id
```

如果满足，说明这条消息是发给当前用户的桌面智能体。

然后用户B桌面端把这条消息交给本地桌面智能体处理。

### 5.1 不能把“对方普通消息”当作发给本机智能体

桌面端不能使用下面这种兼容逻辑：

```text
两人频道里，只要是对方发来的普通消息，就默认当作发给本机桌面智能体
```

原因：

```text
普通聊天会被误触发
容易造成智能体乱回复
后续多人、多智能体频道会彻底混乱
```

P0 必须坚持：

```text
只有 payload.target.type == user_desktop_agent
并且 payload.target.user_id == 当前登录用户id
才交给本机桌面智能体处理
```

### 5.2 桌面智能体领取处理权

用户B桌面端准备处理一条目标消息前，需要先向后端领取：

```http
POST /api/channels/{channel_id}/agent-claims
```

请求：

```json
{
  "message_id": "original_message_id"
}
```

后端按下面唯一规则处理：

```text
同一条消息 + 同一个用户的桌面智能体，只能 claim 成功一次
```

也就是：

```text
message_id + agent_owner_user_id 唯一
```

如果 claim 成功，当前客户端才调用本地桌面智能体。

如果 claim 已经存在，说明这条消息已经被同一个用户的某个桌面端进程领取过，当前客户端不能再处理，避免重复回复。

### 5.3 本地防抖与后端 claim 的关系

桌面端本地可以继续维护：

```text
handledDesktopAgentMessageIds
inFlightDesktopAgentMessageIds
channelAgentJobs
```

这些只负责当前进程内防抖。

真正跨进程、跨重启、跨 SSE 重连的幂等保证必须靠后端 `channel_agent_claims`。

### 5.4 回复完成后的 claim 状态

用户B桌面智能体回写回复消息时，回复消息需要带：

```text
sender_type = user_desktop_agent
payload.source.type = user_desktop_agent
payload.source.user_id = 用户B id
payload.reply_to_message_id = 原始请求 message_id
```

后端保存这条回复后，可以把对应 claim 标记为：

```text
completed
```

如果本地处理失败，可以标记为：

```text
failed
```

## 6. 用户B桌面智能体如何处理

用户B桌面智能体收到消息后，先做意图判断。

建议判断为以下类型：

```text
chat
question
task_request
unclear
unsafe_request
```

### 6.1 普通聊天

如果判断为普通聊天：

```text
intent = chat
```

用户B桌面智能体直接回复一条频道消息。

```json
{
  "message_type": "text",
  "text": "我是 mnm0756 的桌面智能体，可以帮你处理本机相关问题。",
  "payload": {
    "source": {
      "type": "user_desktop_agent",
      "user_id": "user_b_id"
    },
    "target": {
      "type": "human",
      "user_id": "user_a_id"
    },
    "intent": "chat",
    "reply_to_message_id": "original_message_id"
  }
}
```

### 6.2 问答咨询

如果判断为问答咨询：

```text
intent = question
```

用户B桌面智能体可以直接回答。

```json
{
  "message_type": "text",
  "text": "这个问题一般需要先检查 package.json、启动脚本和依赖安装情况。",
  "payload": {
    "source": {
      "type": "user_desktop_agent",
      "user_id": "user_b_id"
    },
    "target": {
      "type": "human",
      "user_id": "user_a_id"
    },
    "intent": "question",
    "reply_to_message_id": "original_message_id"
  }
}
```

### 6.3 任务请求

如果判断为任务请求：

```text
intent = task_request
```

P0 不创建正式 task 表，而是用普通频道消息回写任务状态。

等待确认：

```json
{
  "message_type": "text",
  "text": "我理解这是一个任务请求，需要读取本机项目，等待主人确认。",
  "payload": {
    "source": {
      "type": "user_desktop_agent",
      "user_id": "user_b_id"
    },
    "target": {
      "type": "human",
      "user_id": "user_a_id"
    },
    "intent": "task_request",
    "task_status": "waiting_approval",
    "reply_to_message_id": "original_message_id"
  }
}
```

执行中：

```json
{
  "message_type": "text",
  "text": "正在检查项目配置...",
  "payload": {
    "source": {
      "type": "user_desktop_agent",
      "user_id": "user_b_id"
    },
    "target": {
      "type": "human",
      "user_id": "user_a_id"
    },
    "intent": "task_request",
    "task_status": "running",
    "reply_to_message_id": "original_message_id"
  }
}
```

执行完成：

```json
{
  "message_type": "text",
  "text": "检查完成，问题在 package.json 的 start 脚本。",
  "payload": {
    "source": {
      "type": "user_desktop_agent",
      "user_id": "user_b_id"
    },
    "target": {
      "type": "human",
      "user_id": "user_a_id"
    },
    "intent": "task_request",
    "task_status": "completed",
    "reply_to_message_id": "original_message_id"
  }
}
```

执行失败：

```json
{
  "message_type": "text",
  "text": "执行失败：未找到指定项目目录。",
  "payload": {
    "source": {
      "type": "user_desktop_agent",
      "user_id": "user_b_id"
    },
    "target": {
      "type": "human",
      "user_id": "user_a_id"
    },
    "intent": "task_request",
    "task_status": "failed",
    "reply_to_message_id": "original_message_id"
  }
}
```

### 6.4 需要澄清

如果消息不够明确：

```text
intent = unclear
```

用户B桌面智能体反问：

```json
{
  "message_type": "text",
  "text": "我需要知道项目路径，才能继续检查。",
  "payload": {
    "source": {
      "type": "user_desktop_agent",
      "user_id": "user_b_id"
    },
    "target": {
      "type": "human",
      "user_id": "user_a_id"
    },
    "intent": "unclear",
    "reply_to_message_id": "original_message_id"
  }
}
```

### 6.5 高风险请求

如果判断为高风险：

```text
intent = unsafe_request
```

默认拒绝或强确认。

```json
{
  "message_type": "text",
  "text": "这个请求涉及高风险操作，已拒绝自动执行。",
  "payload": {
    "source": {
      "type": "user_desktop_agent",
      "user_id": "user_b_id"
    },
    "target": {
      "type": "human",
      "user_id": "user_a_id"
    },
    "intent": "unsafe_request",
    "task_status": "rejected",
    "reply_to_message_id": "original_message_id"
  }
}
```

## 7. 用户B桌面端权限策略

P0 权限先放在用户B桌面端本地处理，不做复杂后端权限表。

建议默认策略：

```text
普通聊天：自动允许
普通问答：自动允许
读取本机文件：需要确认
执行命令：需要确认
修改文件：强确认
高风险命令：拒绝或强确认
```

用户B确认弹窗示例：

```text
caixikai02 想让你的桌面智能体执行：

“你帮我看一下这个项目为什么启动失败”

可能需要：
- 读取本机项目文件
- 执行检查命令

允许 / 拒绝
```

## 8. 用户B桌面智能体能否主动回答和执行任务

可以。

但 P0 的“主动”是指：

```text
收到明确 target 到自己的消息后主动响应
```

不是无触发地随意发言。

### 8.1 可以主动回答

用户B桌面端收到发给自己的消息后，可以自动调用本地智能体并回复。

对用户A来说，表现就是：

```text
用户B的桌面智能体主动回答了我
```

### 8.2 可以执行任务

如果本地智能体判断消息是任务请求，就可以：

```text
判断风险
弹窗确认或自动接受
执行任务
回写状态
回写结果
```

### 8.3 不建议 P0 支持无触发主动发言

不建议 P0 支持：

```text
用户B桌面智能体没有收到消息，也自己在频道里主动说话
```

原因：

```text
容易打扰频道
权限边界不清晰
可能泄露用户B本机信息
很难判断什么时候该主动说话
```

这可以留给后续的主动 Agent 能力。

## 9. 桌面端 UI 调整

### 9.1 用户A侧

搜索用户后，不再只是“添加成员”。

推荐文案：

```text
邀请联系人
搜索 email 或 citizen_id
和 TA 的桌面智能体对话
```

频道输入框提示：

```text
发送给：mnm0756 的桌面智能体
```

用户A只自然输入，不选择“聊天/任务”。

### 9.2 用户B侧

用户B桌面端需要：

```text
监听频道事件
识别 target 指向自己的桌面智能体
调用本地智能体判断 intent
需要权限时弹窗确认
执行后回写频道消息
```

### 9.3 消息展示

普通回复显示为普通桌面智能体气泡。

任务状态可以先用普通消息展示：

```text
我理解这是任务请求，等待确认。
正在检查项目配置...
检查完成，问题在 package.json...
```

后续可以升级成任务卡片。

### 9.4 消息左右显示规则

频道消息的左右方向不是按“人类 / 智能体”判断，而是按“这条消息属于哪个用户账号”判断。

规则：

```text
message.sender_user_id == 当前登录用户id
  -> 靠右显示

message.sender_user_id != 当前登录用户id
  -> 靠左显示
```

这意味着：

```text
当前用户本人发的消息：靠右
当前用户桌面智能体发的消息：靠右
对方本人发的消息：靠左
对方桌面智能体发的消息：靠左
```

示例：

```text
caixikai02 端：
caixikai02 本人 -> 右侧
caixikai02 桌面智能体 -> 右侧
1848002 本人 -> 左侧
1848002 桌面智能体 -> 左侧

1848002 端：
1848002 本人 -> 右侧
1848002 桌面智能体 -> 右侧
caixikai02 本人 -> 左侧
caixikai02 桌面智能体 -> 左侧
```

发送方名称规则：

```text
sender_type = user
  -> 显示参与者名称

sender_type = user_desktop_agent
  -> 显示“参与者名称 桌面智能体”
```

显示名称来源优先级：

```text
participants.display_name
participants.nickname
participants.email_masked
participants.citizen_id
sender_user_id
频道成员
```

不能从频道名称反推发送方。

### 9.5 本地消息与远端历史消息合并规则

用户发送消息后，桌面端会先插入本地乐观消息；随后后端会通过历史接口或 SSE 返回正式消息。

合并规则：

```text
同一个 channel_id + 同一个 client_message_id
只保留一条
以后端正式消息为准
```

桌面端需要在收到远端消息时，用 `client_message_id` 删除对应本地临时消息，避免同一条消息显示两遍。

后端需要对 `channel_messages(channel_id, client_message_id)` 建唯一索引，避免同一条客户端消息被重复保存。

## 10. 后端 P0 检查点

后端 P0 只需要确认：

```text
1. POST /api/channels 能创建包含用户A和用户B的频道
2. POST /api/channels/{channel_id}/messages 能保存 payload_json
3. message_added SSE 能把 payload 原样推给频道成员
4. 用户B离线时消息仍能保存在后端
5. 用户B上线后可以拉取频道消息，补处理未处理的 target 消息
6. GET /api/channels/{channel_id}/participants 能返回真实参与者显示字段
7. POST /api/channels/{channel_id}/agent-claims 能保证同一目标消息只被同一用户的桌面智能体处理一次
8. channel_messages.sender_type 支持 user_desktop_agent
9. channel_messages 按 channel_id + client_message_id 去重
```

如果这几点都满足，后端可以不新增接口。

这里的“不新增接口”指不新增 `direct-desktop-agent` 这类专门发送接口；为了保证消息显示和幂等处理，可以保留 `participants` 与 `agent-claims` 这类频道配套接口。

## 11. 用户B离线场景

如果用户B桌面端不在线：

```text
用户A消息正常保存到后端
不会立即执行任务
用户B上线后，桌面端拉取频道消息
找到未处理的 target=user_desktop_agent 消息
再交给本地智能体处理
```

为了避免重复处理，用户B上线补扫历史消息时也必须先调用后端 `agent-claims`。

本地记录已处理 `message_id` 只能作为当前进程的辅助缓存，不能作为最终依据。

## 12. P0 实现步骤

### P0.1 桌面端发送目标

用户A搜索用户B后，创建/进入频道。

发送消息时带：

```json
{
  "target": {
    "type": "user_desktop_agent",
    "user_id": "user_b_id"
  }
}
```

### P0.2 用户B桌面端识别目标消息

用户B桌面端收到消息后，判断：

```text
target.type == user_desktop_agent
target.user_id == 当前登录用户id
sender_user_id != 当前登录用户id
```

### P0.3 用户B桌面智能体判断 intent

调用本地智能体，把消息分类为：

```text
chat / question / task_request / unclear / unsafe_request
```

### P0.4 回复或执行

如果是 chat/question/unclear，直接回复。

如果是 task_request：

```text
判断风险
必要时弹窗确认
执行
回写 running/completed/failed
```

### P0.5 离线补处理

用户B桌面端启动后扫描最近频道消息，处理未处理的 target 消息。

处理前必须先 claim，claim 成功才执行。

### P0.6 消息显示与去重

桌面端需要：

```text
打开频道时加载 participants
用 sender_user_id + sender_type 生成 sender_label
用 sender_user_id == 当前用户id 判断左右
用 client_message_id 合并本地乐观消息和远端正式消息
```

## 13. 后续升级方向

P0 先用 payload 约定跑通。

未来可以逐步升级：

```text
payload.source -> sender_actor_id
payload.target -> target_actor_id
payload.intent -> message intent 字段
payload.task_status -> channel_tasks 表
本地已处理记录 -> 后端 delivery/processing 状态
```

升级后可以支持：

```text
用户A本人 -> 用户B桌面智能体
用户A桌面智能体 -> 用户B桌面智能体
多用户多智能体频道
市场智能体
好友授权和付费智能体好友位
```

## 14. 一句话总结

```text
P0 不新增接口、不建复杂表，只用现有 channels + messages + events；
通过 message.payload 标记 target=user_desktop_agent；
用户B桌面端收到后判断意图、执行任务并用普通频道消息回写结果。
```
