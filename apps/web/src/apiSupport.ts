/**
 * The support surface as the browser sees it (ADR-250, `spec/support.md` §2).
 *
 * The mode is a server fact, never a guess: `GET /support/config` answers it, and a
 * `none` installation answers 404, which is the same "there is nothing here" the client
 * needs. The identity call is a mutation (it may create `users.support_id`), so it goes
 * through `call` and carries the CSRF token like every other mutation.
 */
import { ApiError, call } from "./apiCall";

export type SupportProvider = "none" | "link" | "chatwoot";

/** The waiting text in both product languages; the server owns the wording. */
export interface SupportHours {
  ru: string;
  en: string;
}

export interface SupportConfig {
  provider: SupportProvider;
  /** `link` only: a help page or `mailto:`. */
  url?: string;
  /** `chatwoot` only: the widget page origin, and the only origin the app frames. */
  origin?: string;
  hours: SupportHours;
}

export interface SupportIdentity {
  /** `sup_…`: stable per person and unrelated to the account id. */
  identifier: string;
  /** Hex HMAC the widget passes to Chatwoot Identity Validation. */
  identifierHash: string;
  name: string;
  email: string;
  attributes: {
    remo_user_id: string;
    plan: string | null;
    org_id: string | null;
    org_name: string | null;
    lang: string;
    app_version: string;
    region: string;
  };
}

const NO_SUPPORT: SupportConfig = {
  provider: "none",
  hours: { ru: "", en: "" },
};

/** Call once when a menu opens; a missing surface is `none`, not an error. */
export async function supportConfig(): Promise<SupportConfig> {
  try {
    return await call<SupportConfig>("/support/config");
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return NO_SUPPORT;
    throw error;
  }
}

/** Session required; the first call creates `users.support_id`. */
export function supportIdentity(): Promise<SupportIdentity> {
  return call<SupportIdentity>("/support/identity", { method: "POST" });
}
