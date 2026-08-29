export class CwdSkillsCache {
  constructor() {
    this.entries = new Map();
    this.inflight = new Map();
    this.keyVersions = new Map();
    this.globalVersion = 0;
  }

  invalidate(key) {
    const normalizedKey = String(key || "");
    this.keyVersions.set(normalizedKey, (this.keyVersions.get(normalizedKey) || 0) + 1);
  }

  invalidateAll() {
    this.globalVersion += 1;
  }

  freshValue(key) {
    const entry = this.entries.get(String(key || ""));
    return entry && entry.version === this.versionFor(key) ? entry.value : undefined;
  }

  staleValue(key) {
    return this.entries.get(String(key || ""))?.value;
  }

  async load(key, { forceReload = false, loader } = {}) {
    if (typeof loader !== "function") {
      throw new TypeError("CwdSkillsCache.load requires a loader");
    }
    const normalizedKey = String(key || "");
    if (!forceReload) {
      const fresh = this.freshValue(normalizedKey);
      if (fresh !== undefined) {
        return { value: fresh, cached: true, stale: false, error: null };
      }
      const pending = this.inflight.get(normalizedKey);
      if (pending) return pending;
    } else {
      while (this.inflight.has(normalizedKey)) {
        await this.inflight.get(normalizedKey).catch(() => {});
      }
    }

    const requestVersion = this.versionFor(normalizedKey);
    let request;
    request = Promise.resolve()
      .then(loader)
      .then((value) => {
        this.entries.set(normalizedKey, { value, version: requestVersion });
        return { value, cached: false, stale: false, error: null };
      })
      .catch((error) => {
        const fallback = this.staleValue(normalizedKey);
        if (fallback === undefined) throw error;
        return { value: fallback, cached: true, stale: true, error };
      })
      .finally(() => {
        if (this.inflight.get(normalizedKey) === request) {
          this.inflight.delete(normalizedKey);
        }
      });
    this.inflight.set(normalizedKey, request);
    return request;
  }

  versionFor(key) {
    return `${this.globalVersion}:${this.keyVersions.get(String(key || "")) || 0}`;
  }
}
