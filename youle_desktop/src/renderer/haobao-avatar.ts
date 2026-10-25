export const HAOBAO_COLORS = [
  { id: "cloud", name: "云朵白", base: "#e1e6f1", light: "#ffffff", ink: "#7189bb" },
  { id: "sky", name: "晴空蓝", base: "#7cd3f5", light: "#dff7ff", ink: "#2974aa" },
  { id: "sun", name: "奶油黄", base: "#ffdb76", light: "#fff6d1", ink: "#96702a" },
  { id: "lilac", name: "软糖紫", base: "#d8aff0", light: "#f8e8ff", ink: "#8b59aa" },
  { id: "mint", name: "薄荷绿", base: "#bee18d", light: "#effad6", ink: "#648849" },
  { id: "rose", name: "桃桃粉", base: "#f4b7cd", light: "#fff0f4", ink: "#b96f8a" },
] as const;

export const HAOBAO_CHARACTERS = [
  { id: "classic", name: "小云朵" }, { id: "scholar", name: "小学者" },
  { id: "artist", name: "小画家" }, { id: "cool", name: "酷搭子" },
  { id: "star", name: "追星云" }, { id: "pilot", name: "飞行家" },
] as const;

export const HAOBAO_MOODS = [
  { id: "wink", name: "俏皮" }, { id: "happy", name: "开心" },
  { id: "calm", name: "淡定" }, { id: "curious", name: "好奇" },
  { id: "sleepy", name: "悠闲" }, { id: "love", name: "心动" },
] as const;

export type HaoBaoAppearance = { color: string; character: string; mood: string };
const cloudPath = "M43 156C23 156 13 138 18 120C9 102 19 81 39 78C35 56 56 40 77 48C89 27 120 31 133 51C157 41 181 57 178 80C202 84 211 110 196 128C201 146 186 156 168 156H43";

export function haoBaoOutline() {
  return `<svg class="conversation-list-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19a4.5 4.5 0 0 1-2-8.5A5 5 0 0 1 12 5a5 5 0 0 1 8 5.5A4.5 4.5 0 0 1 18 19Z"/><path d="M9 12v2m6-2-2 1 2 1"/></svg>`;
}

let avatarSequence = 0;
export function renderHaoBaoAvatar(appearance: HaoBaoAppearance, className = "") {
  const color = HAOBAO_COLORS.find(item => item.id === appearance.color) || HAOBAO_COLORS[0];
  const id = `haobao-cloud-${++avatarSequence}`;
  const eyes = appearance.mood === "happy"
    ? '<path d="M68 100q7-12 14 0m39 0q7-12 14 0"/>'
    : appearance.mood === "calm" || appearance.mood === "sleepy"
      ? '<path d="M67 98q8 10 16 0m37 0q8 10 16 0"/>'
      : appearance.mood === "love"
        ? '<path d="M76 108 64 96c-7-10 6-16 12-7 6-9 19-3 12 7Zm52 0-12-12c-7-10 6-16 12-7 6-9 19-3 12 7Z" fill="#d57896" stroke="none"/>'
        : `<ellipse cx="76" cy="98" rx="6" ry="9" fill="${color.ink}" stroke="none"/>${appearance.mood === "curious" ? `<ellipse cx="128" cy="98" rx="6" ry="9" fill="${color.ink}" stroke="none"/>` : '<path d="m135 91-13 7 13 6"/>'}`;
  const accessory = appearance.character === "scholar"
    ? '<g stroke="#48566c" stroke-width="4" fill="none"><circle cx="76" cy="98" r="17"/><circle cx="128" cy="98" r="17"/><path d="M93 96h18M59 95l-9-4m95 4 9-4"/></g><path d="m86 146 17 7 17-7v18l-17-7-17 7Z" fill="#48566c"/>'
    : appearance.character === "artist"
      ? '<ellipse cx="89" cy="49" rx="35" ry="13" transform="rotate(-16 89 49)" fill="#586980"/><path d="m86 37 3-8" stroke="#586980" stroke-width="6" stroke-linecap="round"/>'
      : appearance.character === "cool"
        ? '<g fill="#425067" stroke="#425067" stroke-width="4"><path d="M57 90h37l-4 19q-16 12-29-2Zm54 0h37l-4 17q-14 14-28 2Z"/><path d="M93 94h18"/></g><path d="m65 94 11 0m44 0h10" stroke="#fff" opacity=".65" stroke-width="3"/>'
        : appearance.character === "star"
          ? '<path d="m154 37 5 11 12 1-9 8 2 12-10-6-10 6 2-12-9-8 12-1Z" fill="#ffd86e" stroke="#e8b94e" stroke-width="2"/><path d="m174 132 4-7m-1 16h8" stroke="#e8b94e" stroke-width="3" stroke-linecap="round"/>'
          : appearance.character === "pilot"
            ? '<path d="M60 65q39-21 82 0" stroke="#8b7565" stroke-width="12" fill="none"/><g fill="#d9f1fa" stroke="#657589" stroke-width="4"><rect x="66" y="51" width="29" height="20" rx="8"/><rect x="106" y="51" width="29" height="20" rx="8"/><path d="M95 61h11"/></g><path d="m95 147 30 0-3 12-28-5-13 12-9-8Z" fill="#f4ae8f"/>' : "";
  return `<svg class="haobao-avatar ${className}" viewBox="0 0 216 192" aria-hidden="true" focusable="false">
    <defs><linearGradient id="${id}" x1=".25" y1="0" x2=".72" y2="1"><stop stop-color="${color.light}"/><stop offset=".8" stop-color="${color.base}"/><stop offset="1" stop-color="${color.base}"/></linearGradient><radialGradient id="${id}-glow"><stop stop-color="white" stop-opacity=".7"/><stop offset="1" stop-color="white" stop-opacity="0"/></radialGradient></defs>
    <ellipse cx="108" cy="173" rx="58" ry="6" fill="${color.ink}" opacity=".1"/>
    <path d="${cloudPath}Z" fill="url(#${id})" stroke="${color.base}" stroke-width="1.5"/>
    <ellipse cx="77" cy="74" rx="47" ry="31" fill="url(#${id}-glow)"/>
    <g stroke="${color.ink}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none">${eyes}<path d="M94 119q10 8 19-1" stroke-width="3.5"/></g>
    <g fill="#ed9eb2" opacity=".38"><ellipse cx="56" cy="115" rx="9" ry="4"/><ellipse cx="149" cy="115" rx="9" ry="4"/></g>${accessory}
  </svg>`;
}
