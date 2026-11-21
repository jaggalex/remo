/**
 * EN strings — plans, payment and plan limits (ADR-247, `spec/billing.md` §8).
 *
 * The keys live apart from the organisation table because the whole feature disappears
 * when the installation does not sell plans (`REMO_BILLING=off`). The namespace is still
 * the one flat table (ADR-093).
 */
export const enBilling = {
  "billing.tab": "Plan & payment",

  "billing.plan": "Plan",
  "billing.status": "Status",
  "billing.amount": "Amount",
  "billing.renews": "Renews on",
  "billing.ends": "Ends on",
  "billing.credit": "Credit",
  "billing.usage": "Usage",
  "billing.usage.seats": "Seats {used}/{max}",
  "billing.usage.seatsUnlimited": "Seats {used}, no limit",
  "billing.usage.rooms": "Rooms {used}/{max}",
  "billing.usage.roomsUnlimited": "Rooms {used}, no limit",
  "billing.paymentMethod": "Payment method",
  "billing.cardMasked": "•••• {last4}",
  "billing.cardExpires": "until {month}/{year}",
  "billing.noPaymentMethod": "No saved payment method.",
  "billing.card.replace": "Replace",
  "billing.card.attach": "Add a card",
  "billing.card.unavailable": "Card payment is not available on this installation yet.",
  "billing.card.choosePlan": "A card is saved by a plan payment. Choose a plan first.",
  "billing.card.instructions":
    "Continue in the provider's window. The new card appears here once the provider confirms it.",

  "billing.rooms.title": "Active rooms",
  "billing.rooms.hint":
    "The plan keeps {max} active rooms. The others become read-only: their content is kept and export still works.",
  "billing.rooms.choose": "Choose active rooms",
  "billing.rooms.change": "Change active rooms",
  "billing.rooms.counter": "{selected} of {max} selected",
  "billing.rooms.fewer":
    "Only {selected} of {max} are selected. The other rooms will become read-only.",
  "billing.rooms.save": "Save",
  "billing.rooms.saving": "Saving…",
  "billing.rooms.saved": "Saved",
  "billing.rooms.loadFailed": "Could not load the rooms. Try again.",
  "billing.rooms.empty": "This organisation has no rooms yet.",
  "billing.rooms.badList":
    "The server did not accept this list. Refresh the page and try again.",
  "billing.rooms.gone":
    "One of the rooms no longer belongs to this organisation. Refresh the list.",
  "billing.rooms.forbidden": "Only the organisation owner can choose active rooms.",
  "billing.rooms.askOwner":
    "The organisation is over its room limit. Ask the owner to choose which rooms stay active.",

  "billing.changePlan": "Change plan",
  "billing.cancel": "Cancel subscription",
  "billing.cancelConfirm":
    "The plan stays active until the end of the paid period and does not renew. Continue?",
  "billing.resume": "Resume subscription",
  "billing.askOwner": "Ask the organisation owner to change the plan.",
  "billing.personal":
    "Plans are bought by a shared organisation. Create a shared organisation for the team.",

  "billing.readOnly":
    "The organisation is over its plan limits: rooms are read-only and nothing is deleted.",
  "billing.pastDue":
    "The last payment did not go through. Update the payment method before the grace period ends.",
  "billing.suspended":
    "The subscription is suspended. The organisation works on the free plan until payment.",

  "billing.choose.title": "Choose a plan",
  "billing.choose.hint":
    "The price depends on the period. A promo code is checked before payment.",
  "billing.back": "Back",
  "billing.period": "Billing period",
  "billing.period.month": "Month",
  "billing.period.year": "Year",
  "billing.currency": "Currency",

  "billing.promo": "Promo code",
  "billing.promo.placeholder": "LAUNCH30",
  "billing.promo.check": "Check",
  "billing.promo.applied": "Discount {discount}, total {total}",
  "billing.promo.invalid": "This code cannot be used.",
  "billing.promo.expired": "This code has expired.",
  "billing.promo.currency": "This code is for another currency.",
  "billing.promo.notApplicable": "This code does not apply to the chosen plan.",

  "billing.method": "Payment method",
  "billing.method.ru_card": "Russian bank card or SBP",
  "billing.method.foreign_card": "Foreign card",
  "billing.method.invoice": "Invoice for a company",

  "billing.terms": "I accept the terms of the offer",
  "billing.termsLink": "Terms",
  "billing.pay": "Pay {amount}",
  "billing.paying": "Starting the payment…",
  "billing.checkout.created": "Invoice {id}",
  "billing.checkout.waiting":
    "The invoice is open. The plan activates once the payment is confirmed.",
  "billing.checkout.failed": "Could not start the payment.",
  "billing.checkout.forbidden": "Only an organisation admin can pay.",
  "billing.checkout.currencyLocked": "This organisation pays in another currency.",
  "billing.checkout.consent": "Confirm the terms before paying.",
  "billing.checkout.noRoute": "This payment method is not available right now.",
  "billing.checkout.unavailable": "This plan is not for sale.",

  "billing.invoices": "Invoices",
  "billing.invoiceNumber": "Number",
  "billing.invoiceDate": "Date",
  "billing.invoiceTotal": "Total",
  "billing.invoiceStatus": "Status",
  "billing.invoiceReceipt": "Receipt",
  "billing.invoicesEmpty": "No invoices yet.",
  "billing.invoice.draft": "Draft",
  "billing.invoice.open": "Awaiting payment",
  "billing.invoice.paid": "Paid",
  "billing.invoice.void": "Void",
  "billing.invoice.uncollectible": "Uncollectible",

  "billing.plan.free": "Free",
  "billing.plan.pro": "Pro",
  "billing.plan.team": "Team",
  "billing.plan.business": "Business",
  "billing.plan.unlimited": "Unlimited",
  "billing.subscription.trialing": "Trial",
  "billing.subscription.active": "Active",
  "billing.subscription.past_due": "Payment due",
  "billing.subscription.suspended": "Suspended",
  "billing.subscription.canceled": "Canceled",

  "billing.loading": "Loading…",
  "billing.failed": "Something went wrong. Try again.",
  "billing.noCatalog": "Could not load the plan catalogue.",
  "billing.actionUnavailable":
    "Changing the subscription is not available on this server yet.",
  "billing.close": "Close",

  "billing.planLimit": "Plan limit: {what}",
  "billing.seePlans": "See plans",
  "billing.dismiss": "Dismiss",
  "billing.limit.rooms": "active rooms {current}/{max}",
  "billing.limit.roomsShort": "active rooms",
  "billing.limit.seats": "seats {current}/{max}",
  "billing.limit.seatsShort": "seats",
  "billing.limit.agents": "agent tasks this month {current}/{max}",
  "billing.limit.agentsShort": "agent tasks",
  "billing.limit.other": "this action",
  "billing.feature.export.pdf": "PDF export",
  "billing.feature.export.no_watermark": "PNG without a watermark",
  "billing.feature.link.protect": "Protected public links",
  "billing.feature.roles.advanced": "Advanced roles",
  "billing.feature.integrations": "Integrations",
  "billing.feature.agents.unlimited": "Unlimited agent tasks",
  "billing.feature.other": "this feature",
  "billing.frozenRoom":
    "This room is read-only on the current plan. Its content is kept and export still works.",

  "fake.title": "Test payment provider",
  "fake.hint": "This screen exists only in a development installation. No money moves.",
  "fake.unavailable": "The test payment provider is not available on this installation.",
  "fake.error": "The test provider did not answer. Try again.",
  "fake.amount": "Amount",
  "fake.statusLabel": "Status",
  "fake.status.pending": "Pending",
  "fake.status.succeeded": "Succeeded",
  "fake.status.failed": "Declined",
  "fake.status.canceled": "Canceled",
  "fake.success": "Success",
  "fake.fail": "Decline",
  "fake.finished": "The result is recorded. Return to billing.",
};
