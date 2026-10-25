export interface ChromeTask { taskId: string; profileId: string; tabId: number; prompt: string; snapshot?: unknown }
export interface ChromeTaskBinding { taskHandle: string }
export function chromeTaskModelOptions(models: readonly { value: string; providerId?: string }[]): { model: string; modelProvider: string; serviceTier: null };
export function chromeTaskPrompt(task: ChromeTask, binding: ChromeTaskBinding): string;
export function createChromeTaskReceiver(dependencies: {
  startThread(task: ChromeTask): Promise<string>;
  bindTask(params: { taskId: string; threadId: string }): Promise<ChromeTaskBinding>;
  sendTask(threadId: string, text: string, visibleQuestion: string): Promise<void>;
  reportStatus?(params: { taskId: string; state: string; error?: string }): Promise<unknown>;
  onError?(error: unknown, context: { task: ChromeTask; threadId?: string }): void | Promise<void>;
}): { receive(task: ChromeTask): Promise<{ taskId: string; threadId: string } | null> };
