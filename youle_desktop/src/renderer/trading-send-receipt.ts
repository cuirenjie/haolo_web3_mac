import type { Message } from './domain';

const receiptText: Record<string, string> = {
  'zh-CN': '收到，我正在准备处理你的请求。',
  'zh-TW': '收到，我正在準備處理你的請求。',
  'zh-Hant': '收到，我正在準備處理你的請求。',
  en: 'Received. I’m preparing to handle your request.',
  ja: '受け付けました。リクエストを処理する準備をしています。',
  ko: '요청을 받았습니다. 처리를 준비하고 있습니다.',
};

type PendingSend = { itemId: string; status: string; createdAt: string };

/** A local receipt, derived from the send lifecycle, never model/history input. */
export function tradingSendReceipt(
  threadId: string,
  messages: readonly Message[],
  pending: PendingSend | null | undefined,
  language: string,
): Message | null {
  if (!pending || !['sending', 'uploading'].includes(pending.status)) return null;
  const userIndex = messages.findIndex(message => message.id === pending.itemId);
  if (userIndex < 0) return null;
  return {
    id: `trading-send-receipt-${pending.itemId}`,
    conversation_id: threadId,
    kind: 'agent_text',
    role: 'ceo_assistant',
    text: receiptText[language] || receiptText['zh-CN'],
    created_at: pending.createdAt,
  };
}

type ReceiptEntry = { threadId: string; userId: string; id: string; createdAt: string; text: string };
type ReceiptStorage = Pick<Storage, 'getItem' | 'setItem'>;
const storagePrefix = 'haolo.trading-send-receipts.v1:';

/** Presentation history is account scoped and independent of pending/model history. */
export class TradingSendReceiptStore {
  private entries: ReceiptEntry[] = [];
  private loadedScope: string | null = null;

  constructor(
    private readonly storage: () => ReceiptStorage | null = () => null,
    private readonly scope: () => string = () => '',
  ) {}

  private load() {
    const scope = this.scope();
    if (scope === this.loadedScope) return;
    this.loadedScope = scope;
    this.entries = [];
    if (!scope) return;
    try {
      const saved: unknown = JSON.parse(this.storage()?.getItem(storagePrefix + scope) || '[]');
      if (Array.isArray(saved)) this.entries = saved.filter((entry): entry is ReceiptEntry => (
        entry && ['threadId', 'userId', 'id', 'createdAt', 'text'].every(key => typeof entry[key] === 'string')
        && entry.id.startsWith('trading-send-receipt-')
      ));
    } catch { /* Keep immediate feedback working when local storage is unavailable. */ }
  }

  private save() {
    if (!this.loadedScope) return;
    try { this.storage()?.setItem(storagePrefix + this.loadedScope, JSON.stringify(this.entries)); } catch { /* Display still works in memory. */ }
  }

  moveThread(previousId: string, nextId: string) {
    this.load();
    if (previousId === nextId) return;
    let changed = false;
    for (const entry of this.entries) {
      if (entry.threadId !== previousId) continue;
      entry.threadId = nextId;
      changed = true;
    }
    if (changed) this.save();
  }

  confirmUser(threadId: string, localIds: string[], confirmedId: string) {
    this.load();
    let changed = false;
    for (const entry of this.entries) {
      if (entry.threadId !== threadId || !localIds.includes(entry.userId)) continue;
      entry.userId = confirmedId;
      changed = true;
    }
    if (changed) this.save();
  }

  project(threadId: string, messages: Message[], pending: PendingSend | null | undefined, language: string): Message[] {
    this.load();
    const failedIds = new Set(messages.filter(message => {
      const record = message as unknown as Record<string, unknown>;
      return (record.__youleLocalSendStatus || record.localSendStatus) === 'failed';
    }).map(message => message.id));
    if (pending?.status === 'failed') failedIds.add(pending.itemId);
    const kept = this.entries.filter(entry => entry.threadId !== threadId || !failedIds.has(entry.userId));
    let changed = kept.length !== this.entries.length;
    this.entries = kept;
    const receipt = tradingSendReceipt(threadId, messages, pending, language);
    if (receipt && pending && !failedIds.has(pending.itemId)
      && !this.entries.some(entry => entry.threadId === threadId && entry.userId === pending.itemId)) {
      this.entries.push({ threadId, userId: pending.itemId, id: receipt.id, createdAt: pending.createdAt, text: receipt.text! });
      changed = true;
    }
    if (changed) this.save();
    const byUser = new Map(this.entries.filter(entry => entry.threadId === threadId).map(entry => [entry.userId, entry]));
    const receiptIds = new Set([...byUser.values()].map(entry => entry.id));
    const result: Message[] = [];
    for (const message of messages) {
      if (receiptIds.has(message.id)) continue;
      result.push(message);
      const entry = byUser.get(message.id);
      if (!entry || (message.role !== 'user' && message.kind !== 'user_text')) continue;
      result.push({ id: entry.id, conversation_id: threadId, kind: 'agent_text', role: 'ceo_assistant',
        text: entry.text, created_at: entry.createdAt });
    }
    return result;
  }
}
