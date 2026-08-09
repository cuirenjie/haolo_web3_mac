export type ThreadGroupOnboardingGroup = {
  id?: string | null;
};

export type ThreadGroupOnboardingThread = {
  blank?: boolean;
  placeholder?: boolean;
};

export type ThreadGroupOnboardingState = {
  defaultGroupId: string;
  groups: ThreadGroupOnboardingGroup[];
  threads: ThreadGroupOnboardingThread[];
  autoTaskCount?: number;
  hasPendingGroup?: boolean;
};

export type DeletedThreadGroupThread = {
  groupId?: string | null;
  localBlank?: boolean;
  groupBlank?: boolean;
  empty?: boolean;
};

export type ComposerGroupPickerThread = {
  blank?: boolean;
  groupBlank?: boolean;
};

export function isTopLevelBlankTaskPlaceholder(thread: ComposerGroupPickerThread) {
  return Boolean(thread.blank && !thread.groupBlank);
}

export function isThreadGroupOnboardingEmptyState(state: ThreadGroupOnboardingState) {
  const defaultGroupId = String(state.defaultGroupId || "");
  const hasUserGroup = state.groups.some((group) => {
    const groupId = String(group.id || "");
    return groupId && groupId !== defaultGroupId;
  });
  if (hasUserGroup || state.hasPendingGroup || Number(state.autoTaskCount || 0) > 0) return false;
  return !state.threads.some((thread) => !thread.blank && !thread.placeholder);
}

export function shouldDiscardDeletedThreadGroupBlankThread(thread: DeletedThreadGroupThread, deletedGroupId: string) {
  return Boolean(
    thread.groupId === deletedGroupId &&
      thread.empty &&
      (thread.groupBlank || thread.localBlank),
  );
}

export function shouldActivateTopLevelBlankAfterDiscard(discardedThreadId: string | null | undefined, currentThreadId: string | null | undefined) {
  return Boolean(discardedThreadId && currentThreadId && discardedThreadId === currentThreadId);
}

export function shouldRenderThreadGroupInConversationList(groupId: string | null | undefined, defaultGroupId: string) {
  const normalizedGroupId = String(groupId || "");
  const normalizedDefaultGroupId = String(defaultGroupId || "");
  return Boolean(normalizedGroupId && normalizedGroupId !== normalizedDefaultGroupId);
}

export function shouldRenderComposerGroupPicker(thread: ComposerGroupPickerThread) {
  return isTopLevelBlankTaskPlaceholder(thread);
}

export function threadGroupConversationListDisplayName(groupId: string | null | undefined, groupName: string, defaultGroupId: string, defaultDisplayName: string) {
  const normalizedGroupId = String(groupId || "");
  const normalizedDefaultGroupId = String(defaultGroupId || "");
  return normalizedGroupId && normalizedGroupId === normalizedDefaultGroupId ? defaultDisplayName : groupName;
}
