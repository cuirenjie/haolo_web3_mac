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
            ...(params.fresh === true ? { cache: 'reload' } : {}),
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
    }
    catch (error) {
        if (error?.status === 422 && (error?.code === 'DRAWING_CLOCK_INVALID' || error?.payload?.detail?.code === 'DRAWING_CLOCK_INVALID'))
            throw new Error('DRAWING_CLOCK_INVALID');
        if (method !== 'PUT' || ![413, 422].includes(error?.status)) throw error;
        const detail = error?.payload?.detail;
        // Validation and size rejection happen before a drawing transaction.
        // Return only operation indexes; Pydantic input/msg may contain private
        // drawing text. Electron otherwise drops the HTTP status across IPC.
        const indexes = Array.isArray(detail) && detail.length && detail.every(item =>
            item?.loc?.[0] === 'body' && item.loc[1] === 'operations'
            && Number.isInteger(item.loc[2]) && body.operations?.[item.loc[2]])
            ? [...new Set(detail.map(item => item.loc[2]))] : null;
        // A frozen legacy batch may exceed the new byte budget. The first
        // atomic 413 permits rebuilding it in bounded chunks; a small batch
        // rejected again is retained locally instead of looping forever.
        result = { rejected: 'DRAWING_VALIDATION_REJECTED', indexes:
            error.status === 413 && Buffer.byteLength(JSON.stringify(body)) > 240000 ? [] : indexes };
    }
    if (owner !== String(api.profile?.id || api.profile?.user_id || '') || !api.token)
        throw new Error('DRAWING_ACCOUNT_CHANGED');
    return result;
}
export function registerManualDrawingSync(ipcMain, getApi) {
    ipcMain.handle('youle:manualDrawings', (_event, params) => manualDrawingRequest(getApi(), params));
}
