// Restricted drawing API bridge. Authentication stays in the main process.
export async function manualDrawingRequest(api, params = {}) {
    await api.load();
    const owner = api.token ? String(api.profile?.id || api.profile?.user_id || '') : '';
    if (params.action === 'session')
        return { owner };
    api.requireAuth();
    if (!owner || params.owner !== owner)
        throw new Error('DRAWING_ACCOUNT_CHANGED');
    const prefix = '/api/mobile/v1';
    let path, method = 'GET', body;
    if (params.action === 'read' || params.action === 'write') {
        path = prefix + '/new-task/manual-sync';
        if (params.action === 'read') {
            if (typeof params.market !== 'string' || params.market.length > 128)
                throw new Error('DRAWING_MARKET_INVALID');
            path += `?market=${encodeURIComponent(params.market)}`;
        }
        else {
            method = 'PUT';
            body = params.body;
            if (body?.schemaVersion !== 4)
                throw new Error('DRAWING_SCHEMA_INVALID');
        }
    }
    else
        throw new Error('DRAWING_ACTION_INVALID');
    let result;
    try {
        result = await api.requestJson(`${api.baseUrl.replace(/\/$/, '')}${path}`, {
            method, headers: { ...api.authHeaders(), ...(body ? { 'content-type': 'application/json' } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
    }
    catch (error) {
        if (error?.status === 422 && (error?.code === 'DRAWING_CLOCK_INVALID' || error?.payload?.detail?.code === 'DRAWING_CLOCK_INVALID'))
            throw new Error('DRAWING_CLOCK_INVALID');
        throw error;
    }
    if (owner !== String(api.profile?.id || api.profile?.user_id || '') || !api.token)
        throw new Error('DRAWING_ACCOUNT_CHANGED');
    return result;
}
export function registerManualDrawingSync(ipcMain, getApi) {
    ipcMain.handle('youle:manualDrawings', (_event, params) => manualDrawingRequest(getApi(), params));
}
