/**
 * The billing HTTP entry point (ADR-247, `spec/billing.md` §6).
 *
 * Stage 2 ships the public catalogue, the organisation's plan summary and the
 * frozen-room switch; those routes live in `billing-catalog-api.mjs` because the module
 * is already large enough to have one reason to change. This file is the name the server
 * imports, so checkout, promo codes and invoices can join the same surface without the
 * composition root learning a second module name.
 *
 * With `REMO_BILLING=off` every route in the family answers `404`; that decision stays in
 * the route module, where it is applied once for the whole family.
 */
export { handleBilling } from "./billing-catalog-api.mjs";
