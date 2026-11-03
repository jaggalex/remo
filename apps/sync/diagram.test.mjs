import { describe, expect, it } from "vitest";
import { Y } from "./y.mjs";
import {
  applyDiagram,
  diagramPrompt,
  freeOrigin,
  layoutDiagram,
  parseDiagram,
} from "./diagram.mjs";

const plan = {
  title: "Checkout",
  nodes: [
    { id: "n1", label: "Start", kind: "ellipse" },
    { id: "n2", label: "Pay", kind: "rectangle" },
    { id: "n3", label: "Paid?", kind: "diamond" },
  ],
  edges: [
    { from: "n1", to: "n2", label: "" },
    { from: "n2", to: "n3", label: "ok" },
  ],
};

describe("diagramPrompt", () => {
  it("carries the request and the selected text", () => {
    const prompt = diagramPrompt({
      intent: "Нарисуй процесс оплаты",
      selection: [{ text: "корзина" }, { text: "  " }, { text: "оплата" }],
    });
    expect(prompt.user).toContain("Нарисуй процесс оплаты");
    expect(prompt.user).toContain("корзина");
    expect(prompt.user).not.toContain("  ");
    expect(prompt.system).toContain("JSON only");
  });
});

describe("parseDiagram", () => {
  it("keeps a valid graph and drops broken edges", () => {
    const parsed = parseDiagram({
      title: " Flow ",
      nodes: [
        { id: "a", label: "A", kind: "diamond" },
        { id: "b", label: "B", kind: "unknown" },
        { id: "a", label: "A2" },
        { label: "" },
      ],
      edges: [
        { from: "a", to: "b", label: "go" },
        { from: "a", to: "missing" },
        { from: "b", to: "b" },
        { from: "a", to: "b", label: "again" },
      ],
    });
    expect(parsed.title).toBe("Flow");
    expect(parsed.nodes.map((node) => node.label)).toEqual(["A", "B", "A2"]);
    expect(parsed.nodes[1].kind).toBe("rectangle");
    expect(parsed.edges).toEqual([{ from: "a", to: "b", label: "go" }]);
  });

  it("refuses an empty diagram", () => {
    expect(() => parseDiagram({ nodes: [] })).toThrow(/no nodes/);
  });

  it("enforces the node limit", () => {
    const nodes = Array.from({ length: 50 }, (_, index) => ({ id: `n${index}`, label: `N${index}` }));
    expect(parseDiagram({ nodes }).nodes).toHaveLength(30);
  });
});

describe("layout", () => {
  it("puts depth on x and order within a depth on y", () => {
    const { nodes } = layoutDiagram(plan, { x: 100, y: 200 });
    const [start, pay, paid] = nodes;
    expect(paid.x).toBeGreaterThan(pay.x);
    expect(pay.x).toBeGreaterThan(start.x);
    expect(start.y).toBe(pay.y);
    expect(start.x).toBeGreaterThanOrEqual(100);
    expect(start.y).toBeGreaterThanOrEqual(200);
  });

  it("keeps a cycle on one extra column instead of recursing", () => {
    const cyclic = {
      nodes: [
        { id: "a", label: "A", kind: "rectangle" },
        { id: "b", label: "B", kind: "rectangle" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ],
    };
    const { nodes } = layoutDiagram(cyclic, { x: 0, y: 0 });
    expect(nodes).toHaveLength(2);
    expect(Number.isFinite(nodes[0].x)).toBe(true);
    expect(Number.isFinite(nodes[1].y)).toBe(true);
  });

  it("moves a diagram off an occupied area", () => {
    const size = { width: 300, height: 200 };
    const origin = freeOrigin({ x: 0, y: 0 }, size, [
      { type: "shape", x: 0, y: 0, width: 300, height: 200 },
    ]);
    expect(origin.x).toBeGreaterThanOrEqual(380);
    expect(
      freeOrigin({ x: 0, y: 0 }, size, [
        { type: "connector", x: 0, y: 0, width: 10, height: 10 },
      ]),
    ).toEqual({ x: 0, y: 0 });
  });
});

describe("applyDiagram", () => {
  it("writes nodes, labels and connectors in one transaction", () => {
    const ydoc = new Y.Doc();
    const applied = applyDiagram(ydoc, parseDiagram(plan), {
      origin: { x: 40, y: 60 },
      agent: { id: "a1", name: "Scout" },
      taskId: "t1",
      skill: "diagram",
    });

    expect(applied.nodes).toBe(3);
    expect(applied.edges).toBe(2);
    const widgets = [...ydoc.getMap("widgets").values()];
    expect(widgets).toHaveLength(5);
    expect(widgets.filter((widget) => widget.type === "shape")).toHaveLength(3);
    const connectors = widgets.filter((widget) => widget.type === "connector");
    expect(connectors).toHaveLength(2);
    expect(connectors[1]).toMatchObject({ arrow: "end", routing: "elbow" });
    expect(connectors[1].start.item).toBeTruthy();
    expect(connectors[1].end.item).toBeTruthy();

    const shapes = widgets.filter((widget) => widget.type === "shape");
    expect(shapes[0].createdBy).toBe("Scout · AI");
    expect(shapes[0].agent).toMatchObject({ id: "a1", taskId: "t1", skill: "diagram" });
    expect(shapes.map((shape) => shape.title)).toEqual(["Start", "Pay", "Paid?"]);
    const text = ydoc.getMap("texts").get(shapes[0].id);
    expect(text.toString()).toBe("Start");
  });

  it("does not stack a second diagram on the first", () => {
    const ydoc = new Y.Doc();
    applyDiagram(ydoc, parseDiagram(plan), { origin: { x: 0, y: 0 } });
    applyDiagram(ydoc, parseDiagram(plan), { origin: { x: 0, y: 0 } });
    const shapes = [...ydoc.getMap("widgets").values()].filter((widget) => widget.type === "shape");
    expect(shapes).toHaveLength(6);
    const first = shapes.filter((widget) => widget.x < 400);
    const second = shapes.filter((widget) => widget.x >= 400);
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
  });
});
