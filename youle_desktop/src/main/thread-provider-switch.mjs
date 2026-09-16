// 0.153.4 ignores provider overrides on subscribed or systemError sessions.
// Detach an idle session first; a failed session needs a cold runtime resume.
// Never archive, fork, truncate history, or restart a busy shared runtime.
export async function applyThreadProviderSwitch({ request, baseParams, targetSettings, providerOf, restartIdleRuntime }) {
  const targetProvider = targetSettings.modelProvider;
  const params = {
    ...baseParams,
    model: targetSettings.model,
    modelProvider: targetProvider,
    config: { model_reasoning_effort: targetSettings.effort ?? null },
    serviceTier: targetSettings.serviceTier ?? null,
  };
  await request("thread/unsubscribe", { threadId: baseParams.threadId });
  let result = await request("thread/resume", params);
  if (providerOf(result) !== targetProvider) {
    await restartIdleRuntime();
    result = await request("thread/resume", params);
  }
  const appliedProvider = providerOf(result);
  if (appliedProvider !== targetProvider) {
    throw new Error(`Thread provider switch was not applied (expected ${targetProvider}, received ${appliedProvider || "unknown"}).`);
  }
  return result;
}

export function restartIdleProviderRuntime({ client, isBusy, stop, start }) {
  if (client.__youleProviderSwitchPromise) return client.__youleProviderSwitchPromise;
  if (isBusy()) {
    const error = new Error("Provider recovery is waiting for other active runtime operations to finish.");
    error.code = "PROVIDER_SWITCH_RUNTIME_BUSY";
    return Promise.reject(error);
  }
  // Publish the gate synchronously, before stopping; new RPCs wait for it.
  const operation = Promise.resolve().then(stop).then(start).finally(() => {
    if (client.__youleProviderSwitchPromise === operation) delete client.__youleProviderSwitchPromise;
  });
  client.__youleProviderSwitchPromise = operation;
  return operation;
}
