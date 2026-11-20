/**
 * Manual payment adapter: an invoice the operator confirms by hand (ADR-248,
 * `spec/payment-providers.md` §7).
 *
 * Manual is a real provider in the same interface, not a null object: a company asks for
 * an invoice, the operator marks it paid, and the subscription starts exactly as it would
 * after a card payment. Nothing here talks to a network, needs a secret or accepts a
 * webhook — that absence is the advertised contract, not an unfinished branch.
 *
 * The requisites live in the connection's non-secret `settings`, so the checkout page can
 * show them without the KEK.
 */

/** Empty or whitespace is the same as absent for a text field a person typed. */
function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

export const manualAdapter = {
  provider: "manual",

  capabilities: {
    model: "merchant_scheduled",
    saveMethod: false,
    verifyMethodWithoutCharge: false,
    refunds: "none",
    receipts54fz: false,
    currencies: [],
  },

  /**
   * A manual connection is usable only when the payer has something to read: bank
   * requisites, payment instructions, or both. Returning every problem at once lets the
   * CLI print the whole list instead of one field per run.
   */
  validateConfig(settings = {}) {
    const problems = [];
    const requisites = text(settings?.requisites);
    const instructions = text(settings?.instructions);
    if (!requisites && !instructions) {
      problems.push({
        field: "requisites",
        message: "add payment requisites or instructions; the payer needs both the details and what to do",
      });
    }
    return problems;
  },

  /** There is no provider API to probe: a manual connection is healthy by construction. */
  async healthCheck() {
    return { ok: true, detail: "manual: no provider API to check" };
  },

  /**
   * Manual checkout returns instructions, never a redirect: the payer copies the
   * requisites into their bank and the operator confirms the incoming payment later.
   */
  async createCheckout(conn, req) {
    const settings = conn?.settings ?? {};
    const body = text(settings.instructions) || text(settings.requisites);
    return {
      providerPaymentId: `manual:${req.paymentId}`,
      widget: { kind: "instructions", text: body },
    };
  },

  /** Manual has no webhooks; anything arriving at this URL is not ours. */
  async parseWebhook() {
    return {
      verified: false,
      events: [],
      respond: {
        status: 404,
        body: JSON.stringify({ error: "RESOURCE_NOT_AVAILABLE" }),
        contentType: "application/json",
      },
    };
  },

  /** Without an API there is no status to ask for; the operator's command moves it. */
  async getPayment(_conn, providerPaymentId) {
    return { providerPaymentId, status: "pending" };
  },
};

export default manualAdapter;
