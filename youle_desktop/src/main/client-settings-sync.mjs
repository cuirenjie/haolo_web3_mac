// Only the main process can authenticate. Renderer may access this one route.
export async function clientSettingsRequest(api, params = {}) {
  await api.load();
  api.requireAuth();
  const owner = String(api.profile?.id || api.profile?.user_id || '');
  const baseUrl = api.baseUrl.replace(/\/$/, '');
  if (!owner || params.owner !== owner || params.baseUrl !== baseUrl) throw new Error('SETTINGS_ACCOUNT_CHANGED');
  if (!['read', 'write'].includes(params.action)) throw new Error('SETTINGS_ACTION_INVALID');
  const writing = params.action === 'write';
  if (writing && (params.body?.schemaVersion !== 1 || !Array.isArray(params.body.operations)
    || params.body.operations.length > 1024 || JSON.stringify(params.body).length > 512000)) throw new Error('SETTINGS_INVALID');
  let result;
  try {
    result = await api.requestJson(`${baseUrl}/api/mobile/v1/client-settings`, {
      method: writing ? 'PUT' : 'GET',
      headers: { ...api.authHeaders(), ...(writing ? { 'content-type': 'application/json' } : {}) },
      ...(writing ? { body: JSON.stringify(params.body) } : {}),
    });
  } catch (error) {
    if (error?.payload?.detail?.code === 'SETTINGS_CLOCK_INVALID') throw new Error('SETTINGS_CLOCK_INVALID');
    throw error;
  }
  if (!api.token || owner !== String(api.profile?.id || api.profile?.user_id || '') || baseUrl !== api.baseUrl.replace(/\/$/, '')) throw new Error('SETTINGS_ACCOUNT_CHANGED');
  return result;
}

export function registerClientSettingsSync(ipcMain, getApi) {
  ipcMain.handle('youle:clientSettings', (_event, params) => clientSettingsRequest(getApi(), params));
}
