export type RoleKey = "user" | "ceo_assistant";

export type LegacyRoleKey =
  | "agent_1"
  | "agent_2"
  | "agent_3"
  | "image_assistant"
  | "xhs_publisher"
  | "agent_4"
  | "video_planner"
  | "video_scriptwriter"
  | "video_director"
  | "video_generator"
  | "video_publisher"
  | "hr"
  | "finance_manager";

export const DISABLED_ROLE_KEYS: readonly LegacyRoleKey[] = [
  "agent_1",
  "agent_2",
  "agent_3",
  "image_assistant",
  "xhs_publisher",
  "agent_4",
  "video_planner",
  "video_scriptwriter",
  "video_director",
  "video_generator",
  "video_publisher",
  "hr",
  "finance_manager",
];

export type AgentStatus = "working" | "idle" | "offline" | "fishing" | "training";
export type WorkMode = "plan" | "ask" | "auto";
export type ConversationKind = "main_session" | "group" | "private_chat" | "channel";
export type ConversationStatus = "active" | "paused" | "archived" | "deleted";

export interface RoleMeta {
  id: RoleKey;
  name: string;
  short: string;
  initial: string;
  color: string;
  description?: string;
}

export interface AgentMember {
  id: RoleKey;
  status: AgentStatus;
  name?: string;
  title?: string;
  avatar_text?: string;
  avatar_bg?: string;
  avatar_url?: string | null;
  description?: string;
}

export interface ConversationSummary {
  id: string;
  name: string;
  kind: ConversationKind;
  created_at?: string | null;
  thread_kind?: "local_codex" | "channel" | "provider_chat" | "auto_task" | "group_chat";
  provider?: string | null;
  channel_type?: "group" | "direct";
  status?: ConversationStatus;
  work_mode?: WorkMode | null;
  model_provider?: string | null;
  model?: string | null;
  reasoning_effort?: string | null;
  service_tier?: string | null;
  preview?: string | null;
  preview_time?: string | null;
  unread?: number;
  last_message_at?: string | null;
  last_user_message_at?: string | null;
  avatar_colors?: string[] | null;
  avatar_image?: string | null;
  avatar_bg?: string | null;
  avatar_text?: string | null;
  serious_mode?: boolean;
  pinned?: boolean;
  muted?: boolean;
  task_count?: { active: number; completed: number; failed: number } | null;
  agents?: AgentMember[] | null;
}

export type MessageKind =
  | "user_text"
  | "agent_text"
  | "agent_card"
  | "system"
  | "interaction"
  | "media_generation"
  | "hitl_script"
  | "hitl_image"
  | "hitl_video";

export interface MessageAttachment {
  id?: string | null;
  name: string;
  mime?: string | null;
  size?: number | null;
  object_key?: string | null;
  url?: string | null;
  local_path?: string | null;
  localPath?: string | null;
  path?: string | null;
  file_path?: string | null;
  filePath?: string | null;
  preview_url?: string | null;
  previewUrl?: string | null;
  download_url?: string | null;
  downloadUrl?: string | null;
  material_id?: string | null;
  materialId?: string | null;
  media_reference_label?: string | null;
  mediaReferenceLabel?: string | null;
  mediaMentionLabel?: string | null;
}

export interface MessageImage {
  id: string;
  url: string;
}

export interface MessageAction {
  id?: string;
  kind?: "send" | "navigate" | string;
  label: string;
  text?: string;
  conversation_id?: string;
  destination?: "trading-alerts" | string;
  alert_id?: string;
}

export interface MessageBase {
  id: string;
  conversation_id: string;
  kind: Exclude<MessageKind, "agent_card">;
  role: RoleKey;
  provider?: string | null;
  sender_type?: string | null;
  sender_label?: string | null;
  avatar_url?: string | null;
  align_right?: boolean;
  time?: string | null;
  text?: string | null;
  created_at?: string | null;
  reference?: string | null;
  quoted_message_id?: string | null;
  attachments?: MessageAttachment[] | null;
  images?: MessageImage[] | null;
  actions?: MessageAction[];
  task_id?: string | null;
  gate_id?: string | null;
  withdrawn?: boolean;
}

export interface AgentCardMessage extends Omit<MessageBase, "kind"> {
  kind: "agent_card";
  card: {
    icon: "doc" | "pen" | "image" | "video";
    title: string;
    tag: string;
    tag_status: "done" | "running";
    items: string[];
    footer?: string | null;
    word_count?: string | null;
    progress?: number | null;
  };
}

export type Message = MessageBase | AgentCardMessage;

export type TaskStepStatus = "pending" | "running" | "completed" | "failed" | "pending_external";

export interface TaskStep {
  step_id: string;
  agent_id: RoleKey;
  status: TaskStepStatus;
  streaming_chunks?: string;
  artifact?: { type?: string; reference?: string; url?: string; [key: string]: unknown };
}

export interface TaskSummary {
  id: string;
  skill_id?: string | null;
  status: "pending" | "running" | "completed" | "failed" | "cancelled" | string;
  title?: string | null;
  progress?: { current: number; total: number } | null;
  created_at?: string;
  completed_at?: string | null;
  cost_usd?: number | null;
  primary_artifact?: { type?: string; reference?: string; url?: string; title?: string } | null;
  steps?: TaskStep[];
}

export interface AgentStatusRow {
  agent_id: RoleKey;
  status: AgentStatus;
  conversation_id?: string;
  last_active_at?: string;
}

export interface ProfileSummary {
  id: string;
  email?: string | null;
  phone?: string | null;
  nickname?: string | null;
  avatar_url?: string | null;
  plan?: string;
}

/*
Disabled legacy roles:
- agent_1: 研究员-陆景行
- agent_2: 小红书文案-李佳怡
- agent_3: 小红书生图-苏晓冉
- image_assistant: 图片生成助手
- xhs_publisher: 小红书发布编辑-周雨婷
- agent_4: 影音师-唐静宜
- video_planner: 短视频策划-沈浩然
- video_scriptwriter: 脚本编辑-许若琳
- video_director: 画面导演-林知夏
- video_generator: 视频生成-陈思远
- video_publisher: 视频发布编辑-叶诗宁
- hr: HR-宋清禾
- finance_manager: 财务经理-顾明泽
*/

export const ROLES: Record<RoleKey, RoleMeta> = {
  user: { id: "user", name: "总裁", short: "总裁", initial: "总", color: "#e8755a" },
  ceo_assistant: {
    id: "ceo_assistant",
    name: "HaoLo",
    short: "HaoLo",
    initial: "HaoLo",
    color: "#f4c95d",
    description: "回答老板问题，识别小红书图文和短视频需求并拉起专项群",
  },
};

export const MAIN_SESSION_ROLES: RoleKey[] = ["ceo_assistant"];
// Specialist roles are kept in the type/metadata for old payload compatibility, but are no longer shown.
export const GROUP_ROLES: RoleKey[] = ["ceo_assistant"];

export const STATUS_TEXT: Record<AgentStatus, string> = {
  working: "工作中",
  idle: "待命",
  offline: "离线",
  fishing: "休息中",
  training: "训练中",
};

export const ROLE_AVATAR_URL: Partial<Record<RoleKey, string>> = {
  user: new URL("./assets/haolo-app-avatar.png", import.meta.url).href,
  ceo_assistant: new URL("./assets/haolo-app-avatar.png", import.meta.url).href,
};

export const TEAM_AVATAR_URL = new URL("./assets/haolo-app-avatar.png", import.meta.url).href;

export const HOME_ICON_URL = {
  messageActive: new URL("./assets/nav/message-active.svg", import.meta.url).href,
  autoTask: new URL("./assets/nav/auto-task.svg", import.meta.url).href,
  autoTaskActive: new URL("./assets/nav/auto-task-active.svg", import.meta.url).href,
  autoTaskChat: new URL("./assets/home/icon-auto-task-chat.svg", import.meta.url).href,
  autoTaskEdit: new URL("./assets/home/icon-auto-task-edit.svg", import.meta.url).href,
  autoTaskPause: new URL("./assets/home/icon-auto-task-pause.svg", import.meta.url).href,
  autoTaskRun: new URL("./assets/home/icon-auto-task-run.svg", import.meta.url).href,
  autoTaskCard: new URL("./assets/home/icon-auto-task-card.svg", import.meta.url).href,
  autoTaskAdd: new URL("./assets/home/icon-auto-task-add.svg", import.meta.url).href,
  autoTaskTemplate: new URL("./assets/home/icon-auto-task-template.svg", import.meta.url).href,
  skillsPlaza: new URL("./assets/nav/skills-plaza.svg", import.meta.url).href,
  skillsPlazaActive: new URL("./assets/nav/skills-plaza-active.svg", import.meta.url).href,
  skills: new URL("./assets/home/icon-skills.svg", import.meta.url).href,
  skillLocal: new URL("./assets/home/icon-skill-local.svg", import.meta.url).href,
  skillImportAdd: new URL("./assets/home/icon-skill-import-add.svg", import.meta.url).href,
  skillSort: new URL("./assets/home/icon-skill-sort.svg", import.meta.url).href,
  skillChevronDown: new URL("./assets/home/icon-skill-chevron-down.svg", import.meta.url).href,
  loginLogo: new URL("./assets/haolo-login-logo.png", import.meta.url).href,
  search: new URL("./assets/home/icon-search.svg", import.meta.url).href,
  upload: new URL("./assets/home/icon-upload.svg", import.meta.url).href,
  newChat: new URL("./assets/home/icon-new-chat.svg", import.meta.url).href,
  menuAutoTask: new URL("./assets/images/menu-auto-task.svg", import.meta.url).href,
  menuAddFriend: new URL("./assets/images/menu-add-friend.svg", import.meta.url).href,
  fileForward: new URL("./assets/home/icon-file-forward.svg", import.meta.url).href,
  close: new URL("./assets/home/icon-preview-close.svg", import.meta.url).href,
  previewZoomIn: new URL("./assets/home/icon-preview-zoom-in.svg", import.meta.url).href,
  previewZoomOut: new URL("./assets/home/icon-preview-zoom-out.svg", import.meta.url).href,
  previewDownload: new URL("./assets/home/icon-preview-download.svg", import.meta.url).href,
  editProfile: new URL("./assets/home/icon-edit-profile.svg", import.meta.url).href,
  folder: new URL("./assets/home/icon-folder.svg", import.meta.url).href,
  groupPickerFolder: new URL("./assets/home/icon-group-picker-folder.svg", import.meta.url).href,
  fileOpen: new URL("./assets/home/icon-file-open.svg", import.meta.url).href,
  fileOpenExternal: new URL("./assets/home/icon-file-open-external.svg", import.meta.url).href,
  microphone: new URL("./assets/home/microphone.svg", import.meta.url).href,
  file: new URL("./assets/home/icon-attachment-file.svg", import.meta.url).href,
  pdf: new URL("./assets/home/icon-attachment-pdf.svg", import.meta.url).href,
  word: new URL("./assets/home/icon-attachment-word.svg", import.meta.url).href,
  excel: new URL("./assets/home/icon-attachment-excel.svg", import.meta.url).href,
  ppt: new URL("./assets/home/icon-attachment-ppt.svg", import.meta.url).href,
  thinkingLogo: new URL("./assets/home/logo-blink-final.svg", import.meta.url).href,
};

export function roleDisplayName(role: RoleKey, fallback?: string | null) {
  return ROLES[role]?.name ?? fallback ?? role;
}

export function roleShortName(role: RoleKey) {
  return ROLES[role]?.short ?? role;
}

export function roleAvatarUrl(role: RoleKey) {
  return ROLE_AVATAR_URL[role] ?? ROLE_AVATAR_URL.ceo_assistant ?? "";
}

export function fallbackMembers(kind: ConversationKind): AgentMember[] {
  const roles: RoleKey[] = kind === "group" ? GROUP_ROLES : kind === "main_session" ? MAIN_SESSION_ROLES : ["ceo_assistant"];
  return roles.map((id) => ({ id, status: "idle" }));
}
