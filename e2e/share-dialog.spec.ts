import { expect, test } from "@playwright/test";
import { freshBoard } from "./helpers";

/**
 * Room access on @remo/ui controls (audit M3, sketch D1).
 *
 * The dialog keeps its behaviour — invite, link, password, expiry — and gains the form
 * rules: labelled fields, one primary action, an error next to the field it is about,
 * and a type scale of three sizes inside the body.
 */
test("room access invites, opens the link and puts an error on its field", async ({ page }) => {
  await freshBoard(page, "share-dialog");
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Room access" });
  await expect(dialog).toBeVisible();

  // Labelled fields, not placeholders standing in for labels.
  await dialog.getByLabel("Person").fill("nobody-yet@example.com");
  await expect(dialog.getByLabel("Role", { exact: true })).toHaveValue("viewer");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  // No account with that email: the honest answer is an invitation link to send.
  await expect(dialog.getByLabel(/No account with that email yet/)).toHaveValue(/invite/);

  await dialog.getByRole("button", { name: "Turn on", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Turn off", exact: true })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Public link" })).toHaveValue(/\?room=/);

  // A refused expiry is said on the expiry field, not in a banner at the top.
  const expiry = dialog.getByLabel("Expiry date and time");
  await expiry.fill("2020-01-01T10:00");
  await dialog.getByRole("button", { name: "Set expiry" }).click();
  await expect(expiry).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByRole("alert")).toContainText("The expiry must be in the future.");

  // Type: the title is larger than a group heading, and the body text uses at most three
  // sizes (group, body, caption). Controls carry their own scale and are left out.
  const type = await dialog.evaluate((root) => {
    const size = (el: Element) => Number.parseFloat(getComputedStyle(el).fontSize);
    const sizes = new Set<number>();
    const body = root.querySelector(".share-body")!;
    for (const el of body.querySelectorAll("*")) {
      if (el.closest(".rm-field, .rm-btn, .rm-banner, select, input")) continue;
      const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
      if (ownText) sizes.add(size(el));
    }
    return {
      title: size(root.querySelector(".rm-dialog-title")!),
      group: size(root.querySelector(".share-group-title")!),
      sizes: [...sizes].sort((a, b) => a - b),
    };
  });
  expect(type.title).toBeGreaterThan(type.group);
  expect(type.sizes.length, `body sizes: ${type.sizes.join(", ")}`).toBeLessThanOrEqual(3);
});
