import { BINANCE_REQUEST_PRIORITIES } from "../binance-request-governor.mjs";

// Only this adapter owns admission and execution deadlines. Ordinary fetch
// implementations still need the account service's standalone deadline.
export const ACCOUNT_FETCH_MANAGES_DEADLINE = Symbol("accountFetchManagesDeadline");

export function createBinanceAccountFetch({ governor, router, calendar = false, queueTimeoutMs = 30_000 } = {}) {
  const fetch = (input, init = {}, { timeoutMs = 12_000, prepareUrl } = {}) => {
    // Signing happens after admission, including when admission chooses the
    // private fallback because the direct egress is cooling down.
    const request = (transport) => (_input, options) => transport(
      prepareUrl ? prepareUrl() : input, options,
    );
    return governor.fetch(request(router.privateFetch.bind(router)), input, init, {
      source: calendar ? "account-calendar" : "account",
      priority: calendar ? BINANCE_REQUEST_PRIORITIES.accountInteractive : BINANCE_REQUEST_PRIORITIES.account,
      privateFallbackFetch: router.canUsePrivateGateway()
        ? request(router.privateFallbackFetch.bind(router)) : null,
      timeoutMs,
      queueTimeoutMs,
    });
  };
  fetch[ACCOUNT_FETCH_MANAGES_DEADLINE] = true;
  return fetch;
}
