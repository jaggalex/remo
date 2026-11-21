/**
 * The one outbound HTTP client (ADR-062, ADR-109, ADR-251).
 *
 * Sync and the AI gateway share it, so the DNS-pinning and private-address rules have a
 * single implementation. The runtime is plain ESM: neither consumer has a build step.
 */
export { isPrivateHost } from "./address.mjs";
export {
  MAX_BODY,
  OutboundError,
  assertNotRedirect,
  resolvePublicAddress,
  safeFetch,
  safeFetchWith,
} from "./outbound.mjs";
