/**
 * Deterministic stand-in for the model in browser acceptance runs.
 *
 * A plan is the one thing an e2e scenario cannot get from a real provider: the answer
 * must be the same on every run, cost nothing and never leave the machine. The fake is
 * therefore gated twice — `REMO_AI_FAKE=plan` alone is not enough; the process must also
 * be an e2e run (`REMO_E2E_RUN_ID`) and must not be production. `pnpm e2e` sets both.
 */

export const FAKE_PLAN_MODEL = "fake/plan";

/**
 * A marker a scenario puts in the brief to get the fixture below.
 *
 * The plan validator refuses a centre outside ±1 000 000, but a box may still reach
 * past the edge when its width is added to a centre on the limit. That is exactly the
 * `PLAN_OUT_OF_BOUNDS` warning the preview must treat as critical, so the fixture is a
 * valid plan that a person must not be allowed to apply.
 */
export const FAKE_OUT_OF_BOUNDS_MARKER = "FAKE_PLAN_OUT_OF_BOUNDS";

/**
 * A fixture with two objects and one line, for the scenarios that need a connector.
 *
 * Geometry is fixed: the notes are 320 apart, so the miniature must draw exactly one
 * line between their centres and applying the plan must create exactly one connector
 * (ADR-142, M3).
 */
export const FAKE_CONNECTED_MARKER = "FAKE_PLAN_CONNECTED";

export function fakeOutOfBoundsReply() {
  return {
    operations: [
      {
        op: "create_widgets",
        objects: [
          {
            tempId: "note_safe",
            type: "sticky_note",
            x: 0,
            y: 0,
            width: 161.2,
            height: 184.7,
            text: "Inside the canvas",
          },
          {
            tempId: "note_far",
            type: "sticky_note",
            x: 1_000_000,
            y: 0,
            width: 200,
            height: 120,
            text: "Past the edge",
          },
        ],
      },
    ],
  };
}

/** Two notes and a line: the smallest plan that exercises the connector path. */
export function fakeConnectedReply() {
  return {
    operations: [
      {
        op: "create_widgets",
        objects: [
          {
            tempId: "note_start",
            type: "sticky_note",
            x: 0,
            y: 0,
            width: 161.2,
            height: 184.7,
            text: "Brief",
          },
          {
            tempId: "note_end",
            type: "sticky_note",
            x: 320,
            y: 0,
            width: 161.2,
            height: 184.7,
            text: "Result",
          },
        ],
      },
      {
        op: "create_connector",
        tempId: "link",
        from: "note_start",
        to: "note_end",
        arrow: "end",
      },
    ],
  };
}

/** A marker a scenario puts in a note to get named tidy blocks. */
export const FAKE_TIDY_MARKER = "FAKE_TIDY_LABELS";

/**
 * The tidy reading: the fake parses the selection block and names one or two blocks.
 * It is deliberately dumb — the real engine computes the layout, the fake only labels.
 */
export function fakeTidyReply(prompt = "") {
  const text = String(prompt);
  const start = text.indexOf("<selection");
  const open = text.indexOf(">", start);
  const close = text.indexOf("</selection>", open);
  let objects = [];
  if (start >= 0 && open > start && close > open) {
    try {
      const parsed = JSON.parse(text.slice(open + 1, close));
      objects = Array.isArray(parsed?.objects) ? parsed.objects : [];
    } catch {
      objects = [];
    }
  }
  const ids = objects.map((object) => String(object.id ?? "")).filter(Boolean);
  if (!ids.length) return { strategy: "prefix", blocks: [{ label: "All", ids: [] }] };
  if (text.includes(FAKE_TIDY_MARKER) && ids.length > 1) {
    const half = Math.ceil(ids.length / 2);
    return {
      strategy: "meaning",
      blocks: [
        { label: "Billing", ids: ids.slice(0, half) },
        { label: "Flow", ids: ids.slice(half) },
      ],
    };
  }
  // Without the marker the fake only confirms that a model answered; the strategy
  // stays `prefix`, which is the deterministic reading an e2e can assert exactly.
  return { strategy: "prefix", blocks: [{ label: "All", ids }] };
}

/** The story map every fake reply proposes. Geometry is computed by the real planner. */
export function fakePlanReply(prompt = "") {
  const brief = String(prompt);
  if (brief.includes(FAKE_OUT_OF_BOUNDS_MARKER)) {
    return fakeOutOfBoundsReply();
  }
  if (brief.includes(FAKE_CONNECTED_MARKER)) {
    return fakeConnectedReply();
  }
  return {
    operations: [
      {
        op: "create_structure",
        template: "user-story-map",
        title: "Checkout",
        columns: [
          { title: "Browse", stories: ["See a product", "Add to cart"] },
          { title: "Pay", stories: ["Choose a card", "Confirm"] },
        ],
        swimlanes: [{ title: "Customer", rows: 2 }],
      },
    ],
  };
}

/**
 * A process map for the room-draft skill. The demo has no model, so it recognises the
 * two common subjects and falls back to a neutral shape; the panel says this is a demo
 * fixture, not an analysis of the request.
 */
function sourceHint(prompt) {
  const at = String(prompt).indexOf("Selected material:");
  if (at < 0) return "";
  let best = "";
  for (const line of String(prompt).slice(at).split("\n").slice(1)) {
    const value = line.trim();
    if (!value || value.startsWith("[") || value.startsWith("(")) continue;
    if (value.length > best.length) best = value;
  }
  return best.slice(0, 80);
}

/** The demo shows that the selected material reached the prompt. */
function withSource(reply, hint) {
  if (!hint) return reply;
  reply.objects.push({
    tempId: "source-note",
    type: "text",
    parentRef: "frame",
    x: 40,
    y: 430,
    width: 520,
    height: 90,
    text: `Источник: ${hint}`,
  });
  return reply;
}

export function fakeRoomDraftReply(prompt = "") {
  const request = String(prompt).split("\n")[0].replace(/^Request:\s*/i, "").trim();
  const hint = sourceHint(prompt);
  if (/(плат|оплат|эквайринг|payment|acquiring|checkout)/i.test(request)) {
    return withSource({
      title: "Процесс оплаты",
      objects: [
        { tempId: "frame", type: "frame", x: 0, y: 0, width: 1240, height: 620, title: "Процесс оплаты" },
        { tempId: "start", type: "shape", parentRef: "frame", x: 40, y: 70, width: 240, height: 90, title: "Клиент инициирует оплату", shapeKind: "round_rectangle" },
        { tempId: "check", type: "shape", parentRef: "frame", x: 340, y: 55, width: 210, height: 120, title: "Платёж разрешён?", shapeKind: "diamond" },
        { tempId: "confirm", type: "shape", parentRef: "frame", x: 620, y: 70, width: 220, height: 90, title: "3-D Secure", shapeKind: "round_rectangle" },
        { tempId: "capture", type: "shape", parentRef: "frame", x: 620, y: 250, width: 220, height: 90, title: "Списание средств", shapeKind: "round_rectangle" },
        { tempId: "paid", type: "shape", parentRef: "frame", x: 900, y: 70, width: 220, height: 90, title: "Заказ оплачен", shapeKind: "round_rectangle" },
        { tempId: "refuse", type: "shape", parentRef: "frame", x: 340, y: 280, width: 210, height: 90, title: "Отказ / повтор", shapeKind: "round_rectangle" },
        { tempId: "question", type: "text", parentRef: "frame", x: 40, y: 250, width: 240, height: 120, text: "Кто обрабатывает chargeback?" },
      ],
      connectors: [
        { from: "start", to: "check", arrow: "end", routing: "elbow" },
        { from: "check", to: "confirm", arrow: "end", routing: "elbow", label: "да" },
        { from: "check", to: "refuse", arrow: "end", routing: "elbow", label: "нет" },
        { from: "confirm", to: "capture", arrow: "end", routing: "elbow" },
        { from: "capture", to: "paid", arrow: "end", routing: "elbow" },
      ],
      questions: ["Кто обрабатывает chargeback?", "Что делать при таймауте эквайринга?"],
    }, hint);
  }
  if (/(возврат|refund)/i.test(request)) {
    return withSource({
      title: "Процесс возврата",
      objects: [
        { tempId: "frame", type: "frame", x: 0, y: 0, width: 1100, height: 620, title: "Процесс возврата" },
        { tempId: "start", type: "shape", parentRef: "frame", x: 40, y: 70, width: 240, height: 90, title: "Клиент просит возврат", shapeKind: "round_rectangle" },
        { tempId: "check", type: "shape", parentRef: "frame", x: 340, y: 55, width: 210, height: 120, title: "Условия соблюдены?", shapeKind: "diamond" },
        { tempId: "approve", type: "shape", parentRef: "frame", x: 620, y: 70, width: 220, height: 90, title: "Согласование", shapeKind: "round_rectangle" },
        { tempId: "pay", type: "shape", parentRef: "frame", x: 620, y: 250, width: 220, height: 90, title: "Выплата", shapeKind: "round_rectangle" },
        { tempId: "refuse", type: "shape", parentRef: "frame", x: 340, y: 280, width: 210, height: 90, title: "Отказ", shapeKind: "round_rectangle" },
        { tempId: "question", type: "text", parentRef: "frame", x: 40, y: 250, width: 240, height: 120, text: "Кто согласует отказ?" },
      ],
      connectors: [
        { from: "start", to: "check", arrow: "end", routing: "elbow" },
        { from: "check", to: "approve", arrow: "end", routing: "elbow", label: "да" },
        { from: "check", to: "refuse", arrow: "end", routing: "elbow", label: "нет" },
        { from: "approve", to: "pay", arrow: "end", routing: "elbow" },
      ],
      questions: ["Кто согласует отказ?", "В какой срок возврат обязан быть закрыт?"],
    }, hint);
  }
  const title = (request.replace(/^(опиши|собери|сделай|нарисуй|построй|describe|map|build)\s+/i, "").slice(0, 60)) || "Процесс";
  return withSource({
    title,
    objects: [
      { tempId: "frame", type: "frame", x: 0, y: 0, width: 1100, height: 620, title },
      { tempId: "start", type: "shape", parentRef: "frame", x: 40, y: 70, width: 240, height: 90, title: "Запрос", shapeKind: "round_rectangle" },
      { tempId: "check", type: "shape", parentRef: "frame", x: 340, y: 55, width: 210, height: 120, title: "Условия выполнены?", shapeKind: "diamond" },
      { tempId: "do", type: "shape", parentRef: "frame", x: 620, y: 70, width: 220, height: 90, title: "Основной шаг", shapeKind: "round_rectangle" },
      { tempId: "result", type: "shape", parentRef: "frame", x: 900, y: 70, width: 160, height: 90, title: "Результат", shapeKind: "round_rectangle" },
      { tempId: "exception", type: "shape", parentRef: "frame", x: 340, y: 280, width: 210, height: 90, title: "Исключение", shapeKind: "round_rectangle" },
      { tempId: "question", type: "text", parentRef: "frame", x: 40, y: 250, width: 240, height: 120, text: "Что осталось неясным?" },
    ],
    connectors: [
      { from: "start", to: "check", arrow: "end", routing: "elbow" },
      { from: "check", to: "do", arrow: "end", routing: "elbow", label: "да" },
      { from: "check", to: "exception", arrow: "end", routing: "elbow", label: "нет" },
      { from: "do", to: "result", arrow: "end", routing: "elbow" },
    ],
    questions: ["Что осталось неясным?"],
  }, hint);
}

function fakeProblemMapReply(prompt) {
  const selected = String(prompt).split("Selected material:\n").at(-1) ?? "";
  const source = /^\[1\] id=(\S+)[^\n]*\n([^\n]+)/m.exec(selected);
  return {
    title: "Interview problem map",
    objects: [
      { tempId: "frame", type: "frame", x: 0, y: 0, width: 720, height: 440 },
      { tempId: "theme", type: "text", parentRef: "frame", x: 40, y: 50, width: 440, height: 60,
        text: "Theme: interview findings" },
      { tempId: "observation", type: "sticky_note", parentRef: "frame",
        x: 40, y: 140, width: 250, height: 160, text: source?.[2] ?? "No selected observations" },
      { tempId: "hypothesis", type: "sticky_note", parentRef: "frame",
        x: 350, y: 140, width: 250, height: 160, text: "Hypothesis: is the issue repeated?" },
    ],
    connectors: [],
    citations: source ? [{ tempId: "observation", sourceId: source[1] }] : [],
    questions: ["Is the issue repeated?"],
  };
}

/** A zoned delivery plan for the room-draft skill. */
export function fakeDeliveryReply(prompt = "") {
  const hint = sourceHint(prompt);
  return {
    title: "Спринт 24",
    summary: "Обязательный объём — 3 задачи; ёмкость команды не указана.",
    zones: [
      {
        key: "mandatory",
        label: "Обязательно",
        items: [
          { id: "t1", text: "Экспорт отчёта", meta: "5 SP · Ольга" },
          { id: "t2", text: "Права на экспорт", meta: "? · ?" },
          { id: "t3", text: "Ретраи очереди", meta: "3 SP" },
        ],
      },
      {
        key: "desirable",
        label: "Желательно",
        items: [{ id: "t4", text: "Шаблоны писем", meta: "2 SP" }],
      },
      {
        key: "risks",
        label: "Риски и вопросы",
        items: [
          { id: "r1", text: "Ёмкость команды неизвестна" },
          { id: "r2", text: "Зависимость от API биллинга" },
          ...(hint ? [{ id: "source-1", text: `Источник: ${hint}` }] : []),
        ],
      },
    ],
    dependencies: [{ from: "t1", to: "t2", label: "блокирует" }],
    questions: ["Кто подтвердит ёмкость команды?"],
  };
}

/** Requirements discovery for the demo. */
export function fakeRequirementsReply(prompt = "") {
  const hint = sourceHint(prompt);
  return {
    title: "Требования к возврату",
    summary: "Цель — закрыть возврат за 5 дней; главный пробел — кто согласует отказ.",
    zones: [
      { key: "context", label: "Контекст", items: [
        { id: "c1", text: "Возврат запрашивают из личного кабинета", meta: "" },
        ...(hint ? [{ id: "c2", text: `Источник: ${hint}`, meta: "" }] : []),
      ] },
      { key: "actors", label: "Участники", items: [
        { id: "a1", text: "Клиент", meta: "" },
        { id: "a2", text: "Поддержка", meta: "" },
        { id: "a3", text: "Финансы", meta: "" },
      ] },
      { key: "scenarios", label: "Сценарии", items: [
        { id: "s1", text: "Клиент просит возврат", meta: "" },
        { id: "s2", text: "Поддержка проверяет условия", meta: "" },
        { id: "s3", text: "Финансы подтверждают выплату", meta: "" },
      ] },
      { key: "data", label: "Данные и правила", items: [
        { id: "d1", text: "Платёж, сумма, дата, причина", meta: "" },
        { id: "d2", text: "Правило: 14 дней с момента оплаты", meta: "" },
      ] },
      { key: "constraints", label: "Ограничения", items: [
        { id: "k1", text: "Выплата только на исходный способ оплаты", meta: "" },
        { id: "k2", text: "Срок ответа клиенту — 5 дней", meta: "" },
      ] },
      { key: "questions", label: "Вопросы", items: [
        { id: "q1", text: "Кто согласует отказ?", meta: "" },
      ] },
    ],
    questions: ["Кто согласует отказ?", "Что делать при частичном возврате?"],
  };
}

/** MVP scoping for the demo. */
export function fakeMvpReply(prompt = "") {
  const hint = sourceHint(prompt);
  return {
    title: "MVP возврата",
    hypothesis: "Если вернуть деньги за 5 дней, доля повторных обращений упадёт.",
    columns: [
      { key: "request", label: "Запросить" },
      { key: "check", label: "Проверить" },
      { key: "pay", label: "Получить" },
    ],
    rows: [
      { key: "mvp", label: "MVP" },
      { key: "next", label: "Следующее" },
      { key: "out", label: "Вне объёма" },
    ],
    cells: [
      { row: "mvp", column: "request", items: [{ text: "Форма возврата", meta: "3 SP" }] },
      { row: "mvp", column: "check", items: [{ text: "Проверка условий", meta: "5 SP" }] },
      { row: "mvp", column: "pay", items: [{ text: "Выплата", meta: "8 SP" }] },
      { row: "next", column: "request", items: [{ text: "Повторный возврат", meta: "" }] },
      { row: "out", column: "pay", items: [
        { text: "Частичный возврат", meta: "" },
        ...(hint ? [{ text: `Источник: ${hint}`, meta: "" }] : []),
      ] },
    ],
    questions: ["Кто согласует отказ?"],
  };
}

/** The provider shape `callAgentModel` expects, with no network and no key. */
export function fakePlanClient() {
  return {
    configured: true,
    model: FAKE_PLAN_MODEL,
    baseUrl: "fake://plan",
    async chatJson({ system = "", user = "" } = {}) {
      const text = String(system);
      const tidy = text.includes("group whiteboard objects");
      const delivery = text.includes("delivery lead");
      const requirements = text.includes("requirements analyst");
      const mvp = text.includes("defining an MVP");
      const roomDraft = text.includes("product analyst");
      const json = tidy
        ? fakeTidyReply(user)
        : delivery
          ? fakeDeliveryReply(user)
          : requirements
            ? fakeRequirementsReply(user)
            : mvp
              ? fakeMvpReply(user)
              : roomDraft
                ? text.includes("Build a problem map") ? fakeProblemMapReply(user) : fakeRoomDraftReply(user)
                : fakePlanReply(user);
      return {
        json,
        text: JSON.stringify(json),
        model: FAKE_PLAN_MODEL,
        requestId: null,
        usage: { promptTokens: 0, completionTokens: 0, costUsd: 0 },
      };
    },
  };
}

/**
 * Is the fake allowed in this process?
 *
 * Both flags must be present. A production process refuses even when an operator sets
 * them by hand, so a misconfigured deployment cannot silently lose its model.
 */
export function fakeModelEnabled(env = process.env) {
  if (env.NODE_ENV === "production") return false;
  // A local demo is explicit and never production: one flag gives a deterministic
  // answer without a provider key or a network call.
  if (env.REMO_DEMO === "1") return true;
  if (env.REMO_AI_FAKE !== "plan") return false;
  return Boolean(env.REMO_E2E_RUN_ID);
}
