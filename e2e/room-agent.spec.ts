import { expect, test, type Page } from "@playwright/test";
import { addSticky, agentBoard, openBoard, register, waitForBoardEditor } from "./helpers";

const roomPanel = (page: Page) => page.getByRole("dialog", { name: "Room agent" });
const frames = (page: Page) => page.evaluate(() =>
  window.__remo.widgets.filter((widget) => widget.type === "frame"),
);

async function addEditor(owner: Page, editor: Page, orgId: string, boardId: string) {
  const member = await register(editor, "agent-editor", { user: "Olga Editor" });
  const identity = await editor.request.get("/api/auth/me");
  const { user } = await identity.json();
  const invitation = await owner.request.post(`/api/orgs/${orgId}/invitations`, {
    data: { email: member.email },
  });
  expect(invitation.ok(), await invitation.text()).toBeTruthy();
  const { url } = await invitation.json();
  const accepted = await editor.request.post("/api/invitations/accept", {
    data: { token: new URL(url).searchParams.get("invite") },
  });
  expect(accepted.ok(), await accepted.text()).toBeTruthy();
  const grant = await owner.request.post(`/api/boards/${boardId}/grants`, {
    data: { subjectType: "user", subjectId: user.id, role: "editor" },
  });
  expect(grant.ok(), await grant.text()).toBeTruthy();
  await openBoard(editor, boardId);
  await waitForBoardEditor(editor);
}

test("a selected editor publishes a shared editable draft and loses launch access on revocation", async ({
  page, browser,
}, testInfo) => {
  const { orgId, boardId } = await agentBoard(page, "room-agent-acceptance");
  const colleague = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const editor = await colleague.newPage();
    await addEditor(page, editor, orgId, boardId);
    await page.getByRole("button", { name: "Assign an agent" }).click();
    const ownerPanel = roomPanel(page);
    await ownerPanel.getByRole("button", { name: "Assign an agent" }).click();
    await expect(ownerPanel.getByText("Assigned: Planner")).toBeVisible();
    await editor.reload();
    await waitForBoardEditor(editor);
    await editor.getByRole("button", { name: "Assigned: Planner" }).click();
    const editorPanel = roomPanel(editor);
    await expect(editorPanel.getByText(/Ask the room owner/)).toBeVisible();
    const endpoint = `/api/boards/${boardId}/agent-threads`;
    const intent = "Map the refund process";
    expect((await editor.request.post(endpoint, { data: { intent } })).status()).toBe(403);
    const publicLink = await page.request.put(`/api/boards/${boardId}/link`, {
      data: { enabled: true },
    });
    expect(publicLink.status()).toBe(409);

    const delegate = ownerPanel.getByRole("checkbox", { name: "Olga Editor" });
    await delegate.click();
    await expect(delegate).toBeChecked();
    const create = editorPanel.getByRole("button", { name: "Create draft" });
    await expect(create).toBeVisible();
    await editorPanel.getByRole("textbox").fill(intent);
    const camera = await page.evaluate(() => window.__remo.camera);
    const request = editor.waitForRequest((entry) =>
      entry.method() === "POST" && entry.url().endsWith(endpoint));
    await create.click();
    const first = await request;
    const key = first.headers()["idempotency-key"];
    expect(key).toBeTruthy();
    const replay = await editor.request.post(endpoint, {
      data: first.postDataJSON(), headers: { "Idempotency-Key": key! },
    });
    expect(replay.status()).toBe(200);
    await expect(editorPanel.getByRole("button", { name: "Show on canvas" })).toBeVisible();
    await expect(ownerPanel.getByRole("button", { name: "Show on canvas" })).toBeVisible();
    await expect.poll(() => frames(page)).toHaveLength(1);
    await expect.poll(() => frames(editor)).toHaveLength(1);
    expect(await page.evaluate(() => window.__remo.camera)).toEqual(camera);
    const [frame] = await frames(page);
    const original = await page.evaluate((id) => window.__remo.widgets.find((widget) =>
      widget.type === "shape" && widget.parentId === id)!, frame!.id);

    await ownerPanel.getByRole("button", { name: "Show on canvas" }).click();
    await ownerPanel.getByRole("button", { name: "Close", exact: true }).click();
    const point = await page.evaluate(({ x, y }) => {
      const { camera } = window.__remo;
      const canvas = document.querySelector(".layer.overlay")!.getBoundingClientRect();
      return {
        x: canvas.left + canvas.width / 2 + (x - camera.x) * camera.zoom,
        y: canvas.top + canvas.height / 2 + (y - camera.y) * camera.zoom,
      };
    }, original);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 32, point.y + 20, { steps: 6 });
    await page.mouse.up();
    const remoteX = () => editor.evaluate((id) =>
      window.__remo.widgets.find((widget) => widget.id === id)?.x, original.id);
    await expect.poll(remoteX).not.toBe(original.x);
    const editedX = await remoteX();
    await testInfo.attach("editable draft on canvas", { body: await page.screenshot(), contentType: "image/png" });

    await editorPanel.getByRole("textbox").fill("Add the refund refusal path");
    await editorPanel.getByRole("button", { name: "Send", exact: true }).click();
    await expect(editorPanel.getByRole("button", { name: "Show on canvas" })).toHaveCount(2);
    await expect.poll(() => frames(page)).toHaveLength(2);
    expect(await remoteX()).toBe(editedX);

    await page.getByRole("button", { name: "Assigned: Planner" }).click();
    await delegate.click();
    await expect(delegate).not.toBeChecked();
    await expect(editorPanel.getByRole("textbox")).toHaveCount(0);
    expect((await editor.request.post(endpoint, { data: { intent } })).status()).toBe(403);
    await editor.reload();
    await waitForBoardEditor(editor);
    await editor.getByRole("button", { name: "Assigned: Planner" }).click();
    await expect(editorPanel.getByText(intent, { exact: true }).first()).toBeVisible();
    await expect(editorPanel.getByRole("button", { name: "Show on canvas" })).toHaveCount(2);
    await testInfo.attach("shared room agent history", { body: await editor.screenshot(), contentType: "image/png" });

    await ownerPanel.getByRole("button", { name: "Turn off", exact: true }).click();
    await expect(ownerPanel.getByRole("button", { name: "Assign an agent" })).toBeVisible();
    await ownerPanel.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Share", exact: true }).click();
    const share = page.getByRole("dialog", { name: "Room access" });
    await share.getByRole("button", { name: "Turn on", exact: true }).click();
    await share.getByRole("button", { name: "Turn on link and share drafts" }).click();
    await expect(share.getByRole("button", { name: "Turn off", exact: true })).toBeVisible();

    const external = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
      const visitor = await external.newPage();
      await openBoard(visitor, boardId);
      await expect.poll(() => frames(visitor)).toHaveLength(2);
      await expect(visitor.getByRole("button", { name: "Room agent", exact: true })).toHaveCount(0);
      expect((await visitor.request.get(endpoint)).status()).toBe(401);
      expect((await visitor.request.post(endpoint, { data: { intent } })).status()).toBe(401);
    } finally {
      await external.close();
    }
  } finally {
    await colleague.close();
  }
});

test("a problem map keeps its selected source and identifies a hypothesis", async ({ page }, testInfo) => {
  await agentBoard(page, "agent-interviews");
  await page.getByRole("button", { name: "Assign an agent" }).click();
  const panel = roomPanel(page);
  await panel.getByRole("button", { name: "Assign an agent" }).click();
  await expect(panel.getByText("Assigned: Planner")).toBeVisible();
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  const source = await addSticky(page);
  await expect.poll(() => page.evaluate(() => window.__remo.selectedIds)).toContain(source);
  await page.getByRole("button", { name: "Assigned: Planner" }).click();
  await panel.getByRole("combobox").selectOption("problem-map");
  await panel.getByRole("textbox").fill("Group the interview observations");
  await expect(panel.getByText("Sources: 1")).toBeVisible();
  await panel.getByRole("button", { name: "Create draft" }).click();
  await expect(panel.getByRole("button", { name: "Show on canvas" })).toBeVisible();
  const [frame] = await frames(page);
  const widgets = await page.evaluate(() => window.__remo.widgets);
  expect(widgets).toContainEqual(expect.objectContaining({ id: source, text: "Note" }));
  expect(widgets).toContainEqual(expect.objectContaining({
    parentId: frame!.id,
    text: "Note",
    link: { kind: "widget", widgetId: source },
  }));
  expect(widgets).toContainEqual(expect.objectContaining({
    parentId: frame!.id,
    text: expect.stringContaining("Hypothesis:"),
  }));
  await panel.getByRole("button", { name: "Show on canvas" }).click();
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await testInfo.attach("interview map with citations", { body: await page.screenshot(), contentType: "image/png" });
  const title = await page.evaluate(({ x, y, height }) => {
    const { camera } = window.__remo;
    const canvas = document.querySelector(".layer.overlay")!.getBoundingClientRect();
    return {
      x: canvas.left + canvas.width / 2 + (x - camera.x) * camera.zoom,
      y: canvas.top + canvas.height / 2 + (y - height / 2 + 16 - camera.y) * camera.zoom,
    };
  }, frame!);
  await page.mouse.click(title.x, title.y, { button: "right" });
  await page.getByRole("menuitem", { name: "Info", exact: true }).click();
  await page.getByRole("button", { name: "Open task", exact: true }).click();
  await expect(panel.getByText("Group the interview observations", { exact: true }).first()).toBeVisible();

  // A reload must keep the kind: a clarification continues the same task, it does not
  // silently become a process map (defect found in acceptance).
  await page.reload();
  await waitForBoardEditor(page);
  await page.getByRole("button", { name: "Assigned: Planner" }).click();
  const reopened = roomPanel(page);
  await expect(reopened.getByText("Group the interview observations", { exact: true }).first())
    .toBeVisible();
  const clarification = page.waitForRequest((entry) =>
    entry.method() === "POST" && entry.url().includes("/messages"));
  await reopened.getByRole("textbox").fill("Add another observation");
  await reopened.getByRole("button", { name: "Send", exact: true }).click();
  expect((await clarification).postDataJSON()).toMatchObject({ kind: "problem-map" });
  await expect.poll(() => frames(page)).toHaveLength(2);
  const titles = (await frames(page)).map((widget) => widget.text ?? "");
  expect(titles.some((title) => title.includes("Interview problem map"))).toBe(true);
});

test("requirements and MVP drafts use their own layouts", async ({ page }) => {
  const { boardId, agentId } = await agentBoard(page, "room-agent-skills");
  const assigned = await page.request.put(`/api/boards/${boardId}/agent`, {
    data: { agentId },
  });
  expect(assigned.ok(), await assigned.text()).toBeTruthy();
  for (const [kind, intent] of [
    ["requirements", "Собери требования к возврату"],
    ["mvp-scoping", "Определи MVP возврата"],
    ["retrospective", "Собери ретроспективу спринта"],
    ["decision", "Подготовь решение о возврате"],
    ["meeting-actions", "Извлеки итоги встречи"],
    ["prioritization", "Приоритизируй инициативы"],
    ["competitors", "Сравни конкурентов"],
    ["architecture-decision", "Подготовь архитектурное решение"],
    ["idea-generation", "Сгенерируй идеи"],
    ["dependency-mapping", "Собери зависимости"],
    ["user-flow-design", "Собери user flow"],
    ["architecture-mapping", "Опиши архитектуру"],
  ] as const) {
    const created = await page.request.post(`/api/boards/${boardId}/agent-threads`, {
      data: { intent, kind, sourceIds: [] },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
  }
  await expect.poll(() => frames(page)).toHaveLength(12);
  const texts = await page.evaluate(() =>
    (window as unknown as { __remo: { widgets: Array<{ type: string; text?: string }> } }).__remo.widgets
      // Graph nodes are shapes whose label lives in the shared text; the layout
      // skills write plain text objects. Both carry their label in `text`.
      .filter((widget) => widget.type === "text" || widget.type === "shape")
      .map((widget) => widget.text ?? ""),
  );
  expect(texts).toContain("Контекст");
  expect(texts.some((text) => text.includes("граница MVP"))).toBe(true);
  expect(texts).toContain("Помогало");
  expect(texts).toContain("Вопрос решения");
  expect(texts).toContain("Решения");
  expect(texts).toContain("Эффект");
  expect(texts).toContain("Продукт A");
  expect(texts).toContain("Стоимость");
  expect(texts).toContain("Самообслуживание");
  expect(texts).toContain("API возврата");
  expect(texts).toContain("Кабинет");
  expect(texts).toContain("Клиент");
});
