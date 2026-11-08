import { describe, expect, it } from "vitest";
import { PlanError } from "@remo/agent-plan";
import {
  deliveryPlan,
  parseDeliveryReply,
} from "./agent-delivery-layout.mjs";

const reply = {
  title: "Спринт 24",
  summary: "Обязательный объём — 3 задачи; ёмкость не указана.",
  zones: [
    {
      key: "mandatory",
      label: "Обязательно",
      items: [
        { id: "t1", text: "Экспорт отчёта", meta: "5 SP · Ольга", sourceId: "card-1" },
        { id: "t2", text: "Права на экспорт", meta: "? · ?" },
      ],
    },
    {
      key: "desirable",
      label: "Желательно",
      items: [{ id: "t3", text: "Шаблоны", meta: "3 SP" }],
    },
    {
      key: "risks",
      label: "Риски и вопросы",
      items: [{ id: "r1", text: "Ёмкость команды неизвестна" }],
    },
  ],
  dependencies: [{ from: "t1", to: "t2", label: "блокирует" }],
  questions: ["Кто подтвердит ёмкость?"],
};

const facts = { existingWidgets: [], existingConnectors: [] };

describe("delivery plan reply", () => {
  it("reads the three zones, items and dependencies", () => {
    const parsed = parseDeliveryReply(reply);
    expect(parsed.zones.get("mandatory").items).toHaveLength(2);
    expect(parsed.dependencies).toEqual([
      { from: "t1", to: "t2", label: "блокирует" },
    ]);
  });

  it("rejects an unknown zone, a duplicate id and a dangling dependency", () => {
    expect(() =>
      parseDeliveryReply({
        ...reply,
        zones: [{ key: "someday", label: "", items: [] }],
      }),
    ).toThrow(PlanError);
    expect(() =>
      parseDeliveryReply({
        ...reply,
        zones: [
          {
            key: "mandatory",
            label: "",
            items: [
              { id: "t1", text: "one" },
              { id: "t1", text: "two" },
            ],
          },
        ],
      }),
    ).toThrow(/not unique/);
    expect(() =>
      parseDeliveryReply({
        ...reply,
        dependencies: [{ from: "t1", to: "nope", label: "" }],
      }),
    ).toThrow(/two items/);
  });

  it("refuses an item without text", () => {
    expect(() =>
      parseDeliveryReply({
        ...reply,
        zones: [{ key: "mandatory", label: "", items: [{ id: "t1", text: " " }] }],
      }),
    ).toThrow(PlanError);
  });
});

describe("delivery plan layout", () => {
  it("lays out three columns, summaries, items and the dependency", () => {
    const parsed = parseDeliveryReply(reply);
    const built = deliveryPlan(parsed, { ...facts, sourceIds: ["card-1"] });
    const objects = built.plan.objects;

    expect(objects.filter((object) => object.type === "frame")).toHaveLength(1);
    for (const object of objects) {
      if (object.type !== "frame") expect(object.parentRef).toBe("frame");
    }

    const headers = objects.filter((object) => object.tempId.startsWith("zone-"));
    expect(headers.map((header) => header.tempId)).toEqual([
      "zone-mandatory",
      "zone-desirable",
      "zone-risks",
    ]);
    // The three columns start at the same x pitch.
    expect(headers[1].x - headers[0].x).toBe(headers[2].x - headers[1].x);

    // One summary, one question appended to the risks zone, one connector.
    expect(objects.find((object) => object.tempId === "summary")?.text).toBe(reply.summary);
    expect(objects.some((object) => object.tempId === "item-question-1")).toBe(true);
    expect(built.plan.connectors).toHaveLength(1);
    expect(built.labels).toEqual([
      { from: "item-t1", to: "item-t2", text: "блокирует" },
    ]);

    // The item carries its meta as a second paragraph, not as invented text.
    const first = objects.find((object) => object.tempId === "item-t1");
    expect(first.text).toContain("Экспорт отчёта");
    expect(first.text).toContain("5 SP · Ольга");

    // A citation only survives when the source was actually selected.
    expect(built.citations).toEqual([{ tempId: "item-t1", sourceId: "card-1" }]);
    expect(deliveryPlan(parsed, { ...facts, sourceIds: [] }).citations).toEqual([]);
  });

  it("is deterministic for the same reply", () => {
    const parsed = parseDeliveryReply(reply);
    const one = deliveryPlan(parsed, { ...facts, sourceIds: [] }).plan;
    const two = deliveryPlan(parsed, { ...facts, sourceIds: [] }).plan;
    expect(two.objects).toEqual(one.objects);
    expect(two.bounds).toEqual(one.bounds);
    expect(two.counts).toEqual(one.counts);
  });

  it("still produces three zones when the reply omits them", () => {
    const parsed = parseDeliveryReply({ title: "Пусто", zones: [] });
    const built = deliveryPlan(parsed, facts);
    expect(built.plan.objects.filter((object) => object.tempId.startsWith("zone-"))).toHaveLength(3);
    expect(built.plan.connectors).toEqual([]);
  });
});
