// Only account GETs use this policy. Writes are never replayed, and successful
// account values are not used as a substitute for a failed fresh read.
export function createAccountReadCoordinator({ now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), random = Math.random } = {}) {
  let current = null;
  function invalidate() { current = null; }
  async function run({ scope, key, group = key, ttlMs = 0, isCurrent = () => true }, read) {
    if (!current || current.scope !== scope) current = { scope, pending: new Map(), cache: new Map(), cooldowns: new Map() };
    const state = current;
    const assertCurrent = () => {
      if (current !== state || !isCurrent()) throw Object.assign(new Error("Haolo 账号已切换，请重新读取账户数据。"), { code: "ACCOUNT_CHANGED", retryable: false });
    };
    assertCurrent();
    const cached = state.cache.get(key);
    if (cached?.until > now()) return structuredClone(cached.value);
    state.cache.delete(key);
    const cooldown = state.cooldowns.get("exchange")?.until > now()
      ? state.cooldowns.get("exchange") : state.cooldowns.get(group);
    if (cooldown?.until > now()) {
      throw Object.assign(new Error(cooldown.error.message), {
        code: cooldown.error.code, status: cooldown.error.status, retryable: true,
        retryAfterMs: cooldown.until - now(),
      });
    }
    state.cooldowns.delete(group);
    if (state.pending.has(key)) {
      const value = await state.pending.get(key);
      assertCurrent();
      return structuredClone(value);
    }
    const request = (async () => {
      for (let attempt = 0; ; attempt++) {
        assertCurrent();
        try {
          const value = await read();
          // A binding mutation invalidates all pending responses, too.
          assertCurrent();
          if (ttlMs > 0) state.cache.set(key, { value, until: now() + ttlMs });
          return value;
        } catch (error) {
          const status = Number(error?.status);
          const retryAfterMs = Number(error?.retryAfterMs) || 0;
          const rateLimited = status === 429 || status === 418 || error?.code === "BINANCE_RATE_LIMITED";
          const transient = error?.retryable !== false && error?.name !== "AbortError"
            && (error?.retryable === true || [408, 425, 502, 503, 504].includes(status));
          if (!transient && !rateLimited) throw error;
          if (rateLimited || retryAfterMs > 0 || attempt >= 1) {
            state.cooldowns.set(group, { error, until: now() + Math.max(retryAfterMs, rateLimited ? 15_000 : 1_500) });
            if(error?.code === "BINANCE_RATE_LIMITED" || status === 418)state.cooldowns.set("exchange",state.cooldowns.get(group));
            throw error;
          }
          await sleep(350 + Math.floor(random() * 300));
          // Another dataset may have received a shared exchange cooldown.
          const deferred = state.cooldowns.get("exchange")?.until > now()
            ? state.cooldowns.get("exchange") : state.cooldowns.get(group);
          if (deferred?.until > now()) throw Object.assign(new Error(deferred.error.message), {
            code: deferred.error.code, status: deferred.error.status, retryable: true, retryAfterMs: deferred.until - now(),
          });
        }
      }
    })();
    state.pending.set(key, request);
    try { const value = await request; assertCurrent(); return structuredClone(value); }
    finally { if (state.pending.get(key) === request) state.pending.delete(key); }
  }
  return { run, invalidate };
}
