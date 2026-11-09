import { describe, expect, it } from "vitest";
import { fakeArchitectureMapReply, fakeDependencyReply, fakeUserFlowReply } from "./ai-fake.mjs";
import { fitDraftFrame } from "./agent-room-draft.mjs";
import { graphPlan, parseGraphReply } from "./agent-graph-layout.mjs";

const facts = { existingWidgets: [], existingConnectors: [] };
const cases = [
  ["dependency-mapping", fakeDependencyReply, "API возврата"],
  ["user-flow-design", fakeUserFlowReply, "Кабинет"],
  ["architecture-mapping", fakeArchitectureMapReply, "Клиент"],
];

describe("layered graphs (ADR-192)", () => {
  for (const [name, fixture, firstLabel] of cases) {
    it(`lays out ${name} and keeps it inside the frame`, () => {
      const built = graphPlan(fixture("Request: итоги"), facts);
      const nodes = built.plan.objects.filter((object) => object.tempId.startsWith("node-"));
      expect(nodes.length).toBeGreaterThan(2);
      expect(built.plan.connectors.length).toBeGreaterThan(1);
      expect(nodes.map((node) => node.title)).toContain(firstLabel);
      fitDraftFrame(built.plan);
      const frame = built.plan.objects.find((object) => object.type === "frame");
      for (const child of built.plan.objects.filter((object) => object !== frame)) {
        expect(child.x - child.width / 2).toBeGreaterThanOrEqual(frame.x - frame.width / 2);
        expect(child.y - child.height / 2).toBeGreaterThanOrEqual(frame.y - frame.height / 2);
        expect(child.x + child.width / 2).toBeLessThanOrEqual(frame.x + frame.width / 2);
        expect(child.y + child.height / 2).toBeLessThanOrEqual(frame.y + frame.height / 2);
      }
    });
  }

  it("breaks a cycle into a visible chain instead of refusing", () => {
    const reply = parseGraphReply({
      title: "Cycle",
      nodes: [
        { id: "a", label: "A", kind: "task" },
        { id: "b", label: "B", kind: "task" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ],
    });
    expect(reply.edges).toHaveLength(2);
    const built = graphPlan(reply, facts);
    expect(built.plan.objects.filter((object) => object.tempId.startsWith("node-"))).toHaveLength(2);
    // One line with two heads, because the plan allows one connector per unordered pair.
    expect(built.plan.connectors).toHaveLength(1);
  });

  it("honours an explicit layer as a fact from the source", () => {
    const built = graphPlan(fakeArchitectureMapReply("Request: architecture"), facts);
    const client = built.plan.objects.find((object) => object.tempId === "node-client");
    const api = built.plan.objects.find((object) => object.tempId === "node-api");
    expect(client.x).toBeLessThan(api.x);
  });

  it("rejects an edge to a missing node", () => {
    expect(() =>
      parseGraphReply({
        title: "Bad",
        nodes: [{ id: "a", label: "A", kind: "task" }],
        edges: [{ from: "a", to: "nope" }],
      }),
    ).toThrow(/two nodes/);
  });
});
