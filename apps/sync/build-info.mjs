/**
 * The build identity the service reports (ADR-179).
 *
 * Docker passes these as environment variables; a source checkout gets the defaults.
 * The schema version is separate from the product version and always comes from code.
 */
import { SCHEMA_VERSION } from "./schema-version.mjs";

export function buildInfo(env = process.env) {
  return {
    version: env.REMO_VERSION || "0.0.0-dev",
    build: env.REMO_BUILD || "dev",
    commit: env.REMO_COMMIT || "dev",
    schema: SCHEMA_VERSION,
  };
}
