"""Cursors, the participant cursor and the person/agent marks (spec sections 0, 5, 6).

Every cursor is ink on a white halo: the halo is the same geometry stroked wider in white
and drawn first, so the cursor reads on the canvas, on a pale sticker and on dark ground.
Usage: python3 -I build_cursors.py <out_dir>
"""
import json, math, os, sys

OUT = sys.argv[1]
INK = "#1E2136"
HALO = "#FFFFFF"
os.makedirs(f"{OUT}/cursors", exist_ok=True)
os.makedirs(f"{OUT}/marks", exist_ok=True)

# Arrow on a 32 grid, tip at (6,4): a filled head with a short rounded stem.
ARROW = "M6 4L6 23.5L11 19L14.3 26.5L17.6 25L14.4 17.8L21 17.4Z"


def filled(d, halo=5):
    return (f'<path d="{d}" fill="{HALO}" stroke="{HALO}" stroke-width="{halo}" stroke-linejoin="round"/>'
            f'<path d="{d}" fill="{INK}" stroke="{INK}" stroke-width="1" stroke-linejoin="round"/>')


def lined(d, w=2.25, halo=5.5):
    return (f'<path d="{d}" fill="none" stroke="{HALO}" stroke-width="{halo}" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<path d="{d}" fill="none" stroke="{INK}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>')


def circ(cx, cy, r):
    return f"M{cx - r} {cy}a{r} {r} 0 1 0 {2 * r} 0a{r} {r} 0 1 0 {-2 * r} 0z"


def hand(open_):
    tops = [8, 6, 7, 10] if open_ else [13, 12, 12.5, 14]
    xs = [11.5, 15.2, 18.9, 22.4]
    fingers = "".join(f"M{x} 16V{t}" for x, t in zip(xs, tops))
    thumb = "M9.5 21L6.5 17" if open_ else "M10 19.5L8.5 18"
    palm = "M9.5 14.5h14a2 2 0 0 1 2 2v3.5a7 7 0 0 1-7 7h-3.5a5.5 5.5 0 0 1-5.5-5.5v-5a2 2 0 0 1 2-2z"
    return (f'<path d="{fingers}{thumb}" stroke="{HALO}" stroke-width="7" stroke-linecap="round" fill="none"/>'
            f'<path d="{palm}" fill="{HALO}" stroke="{HALO}" stroke-width="3.5" stroke-linejoin="round"/>'
            f'<path d="{fingers}{thumb}" stroke="{INK}" stroke-width="3.6" stroke-linecap="round" fill="none"/>'
            f'<path d="{palm}" fill="{INK}"/>')


a = math.radians(-35)
rot_start = (16 + 8.5 * math.cos(a), 16 + 8.5 * math.sin(a))
ROTATE = (f"M{rot_start[0]:.2f} {rot_start[1]:.2f}A8.5 8.5 0 1 0 24.5 16"
          f"M{rot_start[0] - 4.2:.2f} {rot_start[1] - 1.2:.2f}L{rot_start[0]:.2f} {rot_start[1]:.2f}L{rot_start[0] + .6:.2f} {rot_start[1] - 4.4:.2f}")

CURSORS = {
    # name: (body, hotspot, css fallback, when)
    "default": (filled(ARROW), (6, 4), "default", "выбор, пустой холст"),
    "move": (lined("M16 4.5v23M4.5 16h23M12.5 8L16 4.5 19.5 8M12.5 24l3.5 3.5 3.5-3.5M8 12.5L4.5 16 8 19.5M24 12.5l3.5 3.5-3.5 3.5"), (16, 16), "move", "перетаскивание объекта"),
    "grab": (hand(True), (16, 16), "grab", "панорама, готовность"),
    "grabbing": (hand(False), (16, 16), "grabbing", "панорама, тянем"),
    "marquee": (filled("M6 4L6 19.5L10 16L12.6 22L15.2 20.8L12.7 15L18 14.7Z") +
                lined("M19 23v-4h4M27 23v4h-4M19 27v.01", 2, 5), (6, 4), "default", "рамка выделения"),
    "connect": (lined("M16 5v7.5M16 19.5V27M5 16h7.5M19.5 16H27") + lined(circ(25, 25, 3), 2, 5), (16, 16), "crosshair", "инструмент связи"),
    "connect-target": (lined("M16 5v7.5M16 19.5V27M5 16h7.5M19.5 16H27") + filled(circ(25, 25, 3.5), 4), (16, 16), "crosshair", "над допустимым якорем"),
    "waypoint": (filled("M16 9.5l6.5 6.5-6.5 6.5-6.5-6.5z"), (16, 16), "move", "точка маршрута связи"),
    "comment": (filled("M4 28l2.6-7.4A9.5 9.5 0 1 1 11.4 25.4Z") +
                f'<path d="M15.5 11v7M12 14.5h7" stroke="{HALO}" stroke-width="2.25" stroke-linecap="round"/>', (4, 28), "crosshair", "размещение комментария"),
    "resize-ew": (lined("M5 16h22M9 12l-4 4 4 4M23 12l4 4-4 4"), (16, 16), "ew-resize", "маркер по горизонтали"),
    "resize-ns": (lined("M16 5v22M12 9l4-4 4 4M12 23l4 4 4-4"), (16, 16), "ns-resize", "маркер по вертикали"),
    "resize-nwse": (lined("M8 8l16 16M8 13.5V8h5.5M24 18.5V24h-5.5"), (16, 16), "nwse-resize", "угловой маркер ↘"),
    "resize-nesw": (lined("M24 8L8 24M18.5 8H24v5.5M13.5 24H8v-5.5"), (16, 16), "nesw-resize", "угловой маркер ↙"),
    "not-allowed": (lined(circ(16, 16, 9) + "M9.6 22.4L22.4 9.6", 2.5, 6), (16, 16), "not-allowed", "действие недоступно; рядом всегда текст причины"),
    "rotate": (lined(ROTATE), (16, 16), "grab", "поворот — только если появится в интерфейсе"),
}

meta = {}
for name, (body, hot, fb, when) in CURSORS.items():
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">{body}</svg>\n'
    open(f"{OUT}/cursors/remo-cursor-{name}.svg", "w").write(svg)
    meta[name] = {"hotspot": {"x": hot[0], "y": hot[1]}, "hotspot2x": {"x": hot[0] * 2, "y": hot[1] * 2},
                  "fallback": fb, "when": when,
                  "css": f'url("remo-cursor-{name}.svg") {hot[0]} {hot[1]}, {fb}'}
json.dump(meta, open(f"{OUT}/cursors/cursors.json", "w"), ensure_ascii=False, indent=1)

# Participant cursor: the concept's arrow points up-right; the tether runs from the tip
# to a person mark, so the point itself is never covered.
REMOTE_ARROW = "M26 6L6.5 14.5L13 17L10.5 23.5L13.5 25L16.3 18.6L21.5 24.5Z"
TIP = (26, 6)
NODE = (29, 3)


def person_mark(cx, cy, r, initials, ring, font=None):
    fs = font or round(r * 0.82, 1)
    # One ring in the person's colour, no ink outline (ADR-185).
    return (f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="#FFFFFF" stroke="{ring}" stroke-width="1.5"/>'
            f'<text x="{cx}" y="{cy}" dy="0.35em" text-anchor="middle" font-family="Golos Text, system-ui, sans-serif" '
            f'font-weight="600" font-size="{fs}" fill="{INK}">{initials}</text>')


# 46 × 40 at 1x: arrow ≈ 20 px tall; the mark is ⌀ 18 so initials stay readable at 1x
# (the concept draws it at half the arrow, which leaves 6 px letters on a real screen).
remote = (f'<svg xmlns="http://www.w3.org/2000/svg" width="46" height="40" viewBox="0 0 46 40">'
          f'<g transform="translate(-2 11)">{filled(REMOTE_ARROW, 5)}'
          f'<circle cx="{NODE[0]}" cy="{NODE[1]}" r="2.25" fill="{INK}" stroke="{HALO}" stroke-width="1.5"/></g>'
          f'{person_mark(35, 10, 9, "АК", "#0F7B6C", 7.5)}</svg>\n')
open(f"{OUT}/cursors/remo-remote-cursor.svg", "w").write(remote)

# Marks
HATCH_ID = "h"


def agent_mark(size, letter):
    s = size
    r = max(2, round(s * 0.14, 1))
    step = max(3, round(s / 5, 1))
    lines = "".join(f"M{-s + i * step} {s}L{i * step} 0" for i in range(0, int(2 * s / step) + 2))
    plate = round(s * 0.5, 1)
    letter_svg = "" if s < 18 else (
        f'<rect x="{(s - plate) / 2}" y="{(s - plate) / 2}" width="{plate}" height="{plate}" rx="{r / 2}" fill="#FFFFFF"/>'
        f'<text x="{s / 2}" y="{s / 2}" dy="0.35em" text-anchor="middle" font-family="Golos Text, system-ui, sans-serif" '
        f'font-weight="600" font-size="{round(plate * 0.8, 1)}" fill="{INK}">{letter}</text>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{s}" height="{s}" viewBox="0 0 {s} {s}">'
            f'<defs><clipPath id="c{s}"><rect x=".75" y=".75" width="{s - 1.5}" height="{s - 1.5}" rx="{r}"/></clipPath></defs>'
            f'<rect x=".75" y=".75" width="{s - 1.5}" height="{s - 1.5}" rx="{r}" fill="#F3F2F0"/>'
            f'<path d="{lines}" stroke="{INK}" stroke-width="{max(1, round(s / 14, 2))}" clip-path="url(#c{s})"/>'
            f'<rect x=".75" y=".75" width="{s - 1.5}" height="{s - 1.5}" rx="{r}" fill="none" stroke="{INK}" stroke-width="1.5"/>'
            f'{letter_svg}</svg>\n')


for s in (16, 18, 22, 28):
    open(f"{OUT}/marks/remo-mark-agent-{s}.svg", "w").write(agent_mark(s, "П"))
    pm = person_mark(s / 2, s / 2, s / 2 - .75, "А" if s < 18 else "АК", "#0F7B6C", round(s * (0.5 if s < 18 else 0.36), 1))
    open(f"{OUT}/marks/remo-mark-person-{s}.svg", "w").write(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{s}" height="{s}" viewBox="0 0 {s} {s}">{pm}</svg>\n')
print("cursors:", len(CURSORS), "+ remote; marks: 8")
