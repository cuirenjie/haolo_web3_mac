// Adapt the account page's account-scoped binding to read-only model tools.
// Resolve dependencies per operation: login/rebind can replace the local runtime.
export function createSharedBinanceAccountReader({
  resolveOwner,
  readStatus,
  readSharedSnapshot,
  getLocalService,
}) {
  async function ownerFor(ownerId) {
    const owner = await resolveOwner();
    if (!ownerId || owner.ownerId !== ownerId) {
      throw Object.assign(new Error("Haolo 账号已切换，请重新读取账户数据。"), {
        code: "ACCOUNT_CHANGED",
        status: 409,
      });
    }
    return owner;
  }

  async function status(ownerId) {
    const owner = await ownerFor(ownerId);
    const result = await readStatus(owner);
    await ownerFor(ownerId);
    // A connection record without credentials cannot supply account facts.
    return {
      ...result,
      bound: result.localBound === true
        || (result.serverCredentialsBound === true && Boolean(result.serverConnectionId)),
    };
  }

  return {
    status,
    async snapshot(ownerId, options) {
      const binding = await status(ownerId);
      if (!binding.bound) {
        throw Object.assign(new Error("Binance 账户尚未完成 API 绑定。"), {
          code: "NOT_BOUND",
          status: 409,
        });
      }
      const result = binding.serverCredentialsBound && binding.serverConnectionId
        ? await readSharedSnapshot(binding.serverConnectionId)
        : await getLocalService().snapshot(ownerId, options);
      await ownerFor(ownerId);
      return result;
    },
  };
}
