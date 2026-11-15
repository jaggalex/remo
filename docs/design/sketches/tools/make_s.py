"""S · Table sizes and headers: the frames of docs/design/table-size-brief.md §8.

Self-contained: palettes and chrome follow the T series; geometry follows
packages/model/src/tableGeometry.ts — header band 40, row-name strip 128, header padding 10,
line height 16, column 120…2400, row 72…2400.
Usage, from the repo root (see ../README.md):
  python3 docs/design/sketches/tools/make_s.py && THEME=dark python3 docs/design/sketches/tools/make_s.py
Writes docs/design/sketches/S/*.dc.html and the canvas notes to S/_notes-<theme>.json.
"""
import json, math, os, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
ICONS = json.load(open(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "docs/design/assets/icons/icons.json")))
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "docs/design/sketches/S")
LIGHT = dict(canvas="#FBFBFA", panel="#FFFFFF", hover="#EFECE8", line="#E4E2DE", strong="#8A8781", ink="#1E2136",
             text2="#58534E", muted="#62657A", focus="#1F5FBF", focusSoft="rgba(31,95,191,.10)", head="#F7F6F4",
             onInk="#FFFFFF", danger="#B42318", link="#174A96", inv="#1E2136", onInv="#FFFFFF")
DARK = dict(canvas="#1E2136", panel="#23263B", hover="#2C2F45", line="#2C2F45", strong="#8A8781", ink="#F3F2F0",
            text2="#D4D1CC", muted="#BFB9B1", focus="#8DB6F0", focusSoft="rgba(141,182,240,.14)", head="#2C2F45",
            onInk="#1E2136", danger="#F39A8B", link="#8DB6F0", inv="#F3F2F0", onInv="#1E2136")
THEME = os.environ.get("THEME", "light")
P = DARK if THEME == "dark" else LIGHT
W, H = 1440, 900
SUFFIX = "-dark" if THEME == "dark" else ""
TAG = " — тёмная" if THEME == "dark" else ""
PAPER_INK = "#1E2136"
Y, OR, BL = "#ECE2C8", "#E2D2C4", "#D8DDE3"
PILL = "border-radius: 999px; font: inherit; display: inline-flex; align-items: center; justify-content: center; gap: 8px; box-sizing: border-box; white-space: nowrap"
BOARDS, NOTES, SERIES = [], {}, []


# ── primitives (as in the T series) ──────────────────────────────────────────────

def ic(name, size=20):
    x = ICONS[name]
    d, f, vb, w = (x.get("d16"), x.get("fill16"), 16, 1.5) if size <= 16 else (x["d"], x.get("fill"), 24, 2)
    b = f'<path d="{d}" fill="none" stroke="currentColor" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>' if d else ""
    b += f'<path d="{f}" fill="currentColor" fill-rule="evenodd"/>' if f else ""
    return f'<svg width="{size}" height="{size}" viewBox="0 0 {vb} {vb}" aria-hidden="true" style="display: block; flex-shrink: 0">{b}</svg>'


def btn(label, kind="out", h=36, icon=None, disabled=False):
    style = {"ink": f"background: {P['ink']}; color: {P['onInk']}; border: 1.5px solid {P['ink']}",
             "out": f"background: {P['panel']}; color: {P['ink']}; border: 1.5px solid {P['ink']}",
             "quiet": f"background: {P['panel']}; color: {P['ink']}; border: 1px solid {P['strong']}",
             "ghost": f"background: transparent; color: {P['ink']}; border: 1.5px solid transparent"}[kind]
    if disabled:
        style = f"background: {P['hover']}; color: {P['muted']}; border: 1px solid {P['line']}"
    pad = f"padding: 0 {12 if h <= 32 else 18}px;" if label else f"width: {h}px; padding: 0;"
    return (f'<button type="button" style="{PILL}; {style}; height: {h}px; {pad} font-size: {13 if h <= 32 else 14}px; font-weight: 500">'
            f'{ic(icon, 16) if icon else ""}{label}</button>')


def iconbtn(name, label, on=False, size=40, raw=None):
    return (f'<button type="button" aria-label="{label}" style="{PILL}; border: 0; width: {size}px; height: {size}px; '
            f'background: {P["hover"] if on else "transparent"}; color: {P["ink"]}">{raw or ic(name, 20)}</button>')


def segmented(items, on=0, h=30, disabled=False):
    cells = "".join(
        f'<button type="button" role="radio" aria-checked="{"true" if i == on else "false"}" style="{PILL}; border: 0; height: {h}px; padding: 0 12px; font-size: 13px; font-weight: 500; '
        f'color: {P["muted"] if disabled else P["ink"]}; {"background: " + P["panel"] + "; box-shadow: 0 0 0 1px " + P["strong"] if i == on else "background: transparent"}">{t}</button>'
        for i, t in enumerate(items))
    return f'<div role="radiogroup" style="display: inline-flex; gap: 2px; padding: 3px; border-radius: 999px; background: {P["hover"]}">{cells}</div>'


def muted(text, size=12, color=None):
    return f'<p style="font-size: {size}px; line-height: {round(size * 1.45)}px; color: {color or P["muted"]}; margin: 0">{text}</p>'


def at(x, y, inner, w=None, z=None):
    return (f'<div style="position: absolute; left: {x}px; top: {y}px; {"width: " + str(w) + "px;" if w else ""} '
            f'{"z-index: " + str(z) + ";" if z else ""}">{inner}</div>')


def sticky(x, y, text, w=96, h=96, fill=Y):
    return (f'<div style="position: absolute; left: {x}px; top: {y}px; width: {w}px; height: {h}px; box-sizing: border-box; '
            f'background: linear-gradient(135deg, #FFFFFF 0%, {fill} 28%, {fill} 100%); border: 1px solid rgba(30,33,54,.2); border-radius: 2px; '
            f'box-shadow: 0 14px 11px -10px rgba(38,30,22,.55); display: flex; align-items: center; justify-content: center; text-align: center; padding: 8px; '
            f'font-size: 13px; line-height: 16px; font-weight: 500; color: {PAPER_INK}; z-index: 2">{text}</div>')


def panel(x, y, w, inner, h=None, pad="18px 20px", z=5, radius=24):
    return (f'<div style="position: absolute; left: {x}px; top: {y}px; width: {w}px; {"height: " + str(h) + "px;" if h else ""} box-sizing: border-box; '
            f'background: {P["panel"]}; border: 1px solid {P["line"]}; border-radius: {radius}px; padding: {pad}; z-index: {z}; color: {P["ink"]}">{inner}</div>')


def note(x, y, text, w=260):
    """A designer annotation on the frame: not product UI."""
    return (f'<div style="position: absolute; left: {x}px; top: {y}px; width: {w}px; font-size: 12px; line-height: 17px; color: {P["muted"]}; '
            f'border-left: 2px solid {P["line"]}; padding-left: 10px; z-index: 7">{text}</div>')


def caption(x, y, text):
    return f'<div style="position: absolute; left: {x}px; top: {y}px; font-size: 12px; font-weight: 600; letter-spacing: .06em; color: {P["muted"]}; z-index: 6">{text.upper()}</div>'


def chip(x, y, text):
    """The drag value chip: height 20, radius-sm, bg-inverse / text-inverse, caption type."""
    return (f'<span role="status" style="position: absolute; left: {x}px; top: {y}px; height: 20px; padding: 0 7px; border-radius: 6px; display: inline-flex; '
            f'align-items: center; background: {P["inv"]}; color: {P["onInv"]}; font-size: 12px; font-weight: 500; white-space: nowrap; z-index: 9">{text}</span>')


def header():
    sun = ic("moon" if THEME == "dark" else "sun", 18)
    return f"""<header style="position: absolute; left: 24px; right: 24px; top: 24px; height: 44px; display: flex; align-items: center; gap: 12px; z-index: 6">
    <span style="display: flex; color: {P['ink']}"><svg width="30" height="30" viewBox="0 0 200 200" aria-label="REMO"><g fill="currentColor"><circle cx="53" cy="48" r="37"/><rect x="111" y="12" width="72" height="72" rx="12"/><path d="M30.02,106 H169.98 A12,12 0 0 1 181.81,120.03 A83,83 0 0 1 18.19,120.03 A12,12 0 0 1 30.02,106 Z"/></g></svg></span>
    {iconbtn("boards", "Комнаты")}
    <span style="font-size: 18px; color: {P['muted']}">Анна Ким /</span><span style="font-size: 18px; font-weight: 500">План релиза</span>
    <span style="display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: {P['muted']}">{ic("saved", 16)}Сохранено</span>
    <span style="flex-grow: 1"></span>
    {iconbtn("panel", "Свойства", True)}{btn("Поделиться", "ink", 40, "share")}
    <span style="display: inline-flex; gap: 2px; padding-left: 8px; border-left: 1px solid {P['line']}">{iconbtn("", "Тема", raw=sun, size=36)}
    <span style="width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 600">RU</span></span></header>"""


def rail():
    items = [("cursor", "Выбор"), ("sticky", "Заметка"), ("text", "Текст"), ("shape", "Фигура"), ("connector", "Связь"), ("frame", "Раздел")]
    b = "".join(iconbtn(n, t, i == 0) for i, (n, t) in enumerate(items))
    return (f'<div style="position: absolute; left: 24px; top: 100px; width: 52px; box-sizing: border-box; background: {P["panel"]}; border: 1px solid {P["line"]}; '
            f'border-radius: 26px; padding: 6px; display: flex; flex-direction: column; gap: 4px; z-index: 6">{b}</div>')


def zoom(pct="100 %"):
    return (f'<div style="position: absolute; left: 24px; bottom: 24px; height: 44px; border-radius: 22px; box-sizing: border-box; background: {P["panel"]}; '
            f'border: 1px solid {P["line"]}; display: flex; align-items: center; padding: 0 14px; gap: 14px; font-size: 13px; font-weight: 500; z-index: 6">'
            f'<span>Вписать</span>{ic("minus", 16)}<span>{pct}</span>{ic("plus", 16)}</div>')


def chrome(pct="100 %"):
    return header() + rail() + zoom(pct)


def page(title, body):
    return f"""<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>{title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600&amp;display=swap">
<style>body{{margin:0}} button{{font:inherit;cursor:default}}</style>
</helmet>
<div style="width: {W}px; height: {H}px; position: relative; overflow: hidden; background: {P['canvas']}; color: {P['ink']}; font-family: 'Golos Text', system-ui, sans-serif">
{body}
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":{W},"height":{H}}}}}'>
class Component extends DCLogic {{
  renderVals() {{ return {{}}; }}
}}
</script>
</body>
</html>
"""


def frame(fid, slug, title, body, rows, status="обязательный"):
    SERIES.append((fid, slug, title, status))
    name = f"S-{fid}-{slug}{SUFFIX}"
    BOARDS.append((name, f"{fid} · {title}{TAG}", page(f"{fid} {title}{TAG}", body)))
    NOTES[name] = f"{fid} · {title} — {status}\n" + "\n".join(rows)


# ── the table, drawn from the product geometry ───────────────────────────────────

class Grid:
    """A section table: header band (hh), row-name strip (hw), columns and rows in px."""

    def __init__(self, x, y, cols, rows, hw=128, hh=40, s=1.0, title="Этапы релиза", heads=None):
        self.x, self.y, self.s = x, y, s
        self.cols, self.rows = cols, rows
        self.hw, self.hh = hw * s, hh * s
        self.cx = [x + self.hw]
        for _, w in cols:
            self.cx.append(self.cx[-1] + w * s)
        self.ry = [y + self.hh]
        for _, h in rows:
            self.ry.append(self.ry[-1] + h * s)
        self.w, self.h = self.cx[-1] - x, self.ry[-1] - y
        self.title, self.heads = title, heads or {}

    def draw(self, fs=13):
        s, out = self.s, ""
        out += (f'<div style="position: absolute; left: {self.x}px; top: {self.y - 26 * s}px; font-size: {13 * s}px; font-weight: 600; z-index: 2">{self.title}</div>'
                if self.title else "")
        out += (f'<div style="position: absolute; left: {self.x}px; top: {self.y}px; width: {self.w}px; height: {self.h}px; box-sizing: border-box; '
                f'background: {P["panel"]}; border: 1.5px solid {P["ink"]}; border-radius: {4 * s}px; overflow: hidden; z-index: 1">'
                f'<div style="position: absolute; left: 0; top: 0; right: 0; height: {self.hh}px; background: {P["head"]}"></div>'
                f'<div style="position: absolute; left: 0; top: 0; bottom: 0; width: {self.hw}px; background: {P["head"]}"></div></div>')
        for cx in self.cx[:-1]:
            out += f'<div style="position: absolute; left: {cx}px; top: {self.y}px; width: 1px; height: {self.h}px; background: {P["line"]}; z-index: 1"></div>'
        for ry in self.ry[:-1]:
            out += f'<div style="position: absolute; left: {self.x}px; top: {ry}px; width: {self.w}px; height: 1px; background: {P["line"]}; z-index: 1"></div>'
        for i, (t, w) in enumerate(self.cols):
            out += self.head_text(self.cx[i], self.y, w * s, self.hh, self.heads.get(("c", i), t), fs)
        for j, (t, h) in enumerate(self.rows):
            out += self.head_text(self.x, self.ry[j], self.hw, h * s, self.heads.get(("r", j), t), fs, top=True)
        return out

    def head_text(self, x, y, w, h, text, fs, top=False):
        s = self.s
        clamp = ""
        if isinstance(text, tuple):  # (text, max_lines) → ellipsis after max_lines
            text, n = text
            clamp = f"display: -webkit-box; -webkit-line-clamp: {n}; -webkit-box-orient: vertical; overflow: hidden;"
        return (f'<div style="position: absolute; left: {x}px; top: {y}px; width: {w}px; height: {h}px; box-sizing: border-box; padding: {10 * s}px {10 * s}px; '
                f'display: flex; align-items: {"flex-start" if top else "center"}; z-index: 2"><div style="font-size: {fs * s}px; line-height: {16 * s}px; '
                f'font-weight: 600; {clamp}">{text}</div></div>')

    def cell(self, i, j, dx=16, dy=16):
        return self.cx[i] + dx * self.s, self.ry[j] + dy * self.s


def vline(x, y, h, color=None, width=1, dashed=False, z=8):
    c = color or P["focus"]
    style = f"border-left: {width}px {'dashed' if dashed else 'solid'} {c}"
    return f'<div aria-hidden="true" style="position: absolute; left: {x - width / 2}px; top: {y}px; height: {h}px; width: 0; {style}; z-index: {z}"></div>'


def hline(x, y, w, color=None, width=1, dashed=False, z=8):
    c = color or P["focus"]
    style = f"border-top: {width}px {'dashed' if dashed else 'solid'} {c}"
    return f'<div aria-hidden="true" style="position: absolute; left: {x}px; top: {y - width / 2}px; width: {w}px; height: 0; {style}; z-index: {z}"></div>'


def hit_zone(x, y, w, h):
    """Hit area shown on component/redline frames only (12 px each side of the line)."""
    return (f'<div aria-hidden="true" style="position: absolute; left: {x}px; top: {y}px; width: {w}px; height: {h}px; box-sizing: border-box; '
            f'background: {P["focusSoft"]}; border: 1px dashed {P["focus"]}; z-index: 7"></div>')


def cursor(x, y, kind="col"):
    """Schematic resize cursors; the drawn assets come from icons-cursors-spec.md."""
    ink, paper = "#1E2136", "#FFFFFF"
    if kind == "col":
        d = "M4 12 H20 M4 12 l4 -4 M4 12 l4 4 M20 12 l-4 -4 M20 12 l-4 4 M12 5 V19"
    elif kind == "row":
        d = "M12 4 V20 M12 4 l-4 4 M12 4 l4 4 M12 20 l-4 -4 M12 20 l4 -4 M5 12 H19"
    else:  # scrub, ew-resize
        d = "M3 12 H21 M3 12 l4 -4 M3 12 l4 4 M21 12 l-4 -4 M21 12 l-4 4"
    return (f'<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" style="position: absolute; left: {x - 12}px; top: {y - 12}px; z-index: 10">'
            f'<path d="{d}" fill="none" stroke="{paper}" stroke-width="4" stroke-linecap="round"/><path d="{d}" fill="none" stroke="{ink}" stroke-width="1.6" stroke-linecap="round"/></svg>')


def focus_ring(x, y, w, h, r=4):
    return (f'<div aria-hidden="true" style="position: absolute; left: {x - 2}px; top: {y - 2}px; width: {w + 4}px; height: {h + 4}px; box-sizing: border-box; '
            f'border: 2px solid {P["focus"]}; border-radius: {r}px; z-index: 9"></div>')


def numfield(label, value, unit="px", state="rest", auto=False, w=280, steppers=None, error=None, disabled=False, touch=False, typing=False):
    """§4.3: scrub label · value · unit · steppers on hover/focus · optional Auto."""
    h = 44 if touch else 32
    show_steps = steppers if steppers is not None else state in ("hover", "focus", "drag")
    border = P["focus"] if state in ("focus", "drag") else (P["danger"] if error else P["strong"])
    bw = 2 if state in ("focus", "drag") else 1
    lab_col = P["muted"] if disabled else (P["ink"] if state in ("hover", "drag") else P["text2"])
    lab_deco = f"text-decoration: underline dotted {P['strong']}; text-underline-offset: 3px;" if state in ("hover", "drag") else ""
    val = "" if auto else str(value)
    ph = f'<span style="color: {P["muted"]}">Авто</span>' if auto else ""
    caret = f'<span style="display: inline-block; width: 1.5px; height: 15px; background: {P["ink"]}; vertical-align: -2px"></span>' if typing else ""
    steps = (f'<span style="display: inline-flex; gap: 2px; margin-left: 4px">'
             f'<span style="width: {h - 8}px; height: {h - 8}px; border-radius: 999px; display: flex; align-items: center; justify-content: center; background: {P["hover"]}">{ic("minus", 16)}</span>'
             f'<span style="width: {h - 8}px; height: {h - 8}px; border-radius: 999px; display: flex; align-items: center; justify-content: center; background: {P["hover"]}">{ic("plus", 16)}</span></span>'
             if show_steps and not disabled else "")
    bg = P["hover"] if disabled else P["panel"]
    body = (f'<div style="display: flex; align-items: center; gap: 10px; width: {w}px">'
            f'<span style="flex: 0 0 auto; font-size: 13px; font-weight: 500; color: {lab_col}; {lab_deco}">{label}</span>'
            f'<span style="flex: 1; display: flex; align-items: center; height: {h}px; box-sizing: border-box; padding: 0 4px 0 12px; border-radius: 999px; '
            f'border: {bw}px solid {border}; background: {bg}; font-size: 13px; font-weight: 500; color: {P["muted"] if disabled else P["ink"]}">'
            f'<span style="font-variant-numeric: tabular-nums">{val}</span>{caret}{ph}<span style="margin-left: 4px; color: {P["muted"]}">{"" if auto else unit}</span>'
            f'<span style="flex: 1"></span>{steps}</span></div>')
    if error:
        body += f'<div style="margin-top: 6px; font-size: 12px; color: {P["danger"]}">{error}</div>'
    return body


def popover(x, y, title, inner, w=320, z=9):
    return (f'<div role="dialog" style="position: absolute; left: {x}px; top: {y}px; width: {w}px; box-sizing: border-box; background: {P["panel"]}; '
            f'border: 1px solid {P["line"]}; border-radius: 20px; padding: 16px 18px; z-index: {z}; color: {P["ink"]}">'
            f'<div style="font-size: 14px; font-weight: 600; margin-bottom: 12px">{title}</div>{inner}</div>')


def axis_popover_body(mode=1, value=245, field_state="rest", auto=False, kind="col"):
    names = ["Узкая", "Средняя", "Широкая"] if kind == "col" else ["Низкая", "Средняя", "Высокая"]
    lab = "Ширина" if kind == "col" else "Высота"
    return (segmented(["Авто", "Вручную"], mode)
            + f'<div style="margin-top: 6px">{muted("Растёт под содержимое, но не сжимается само.")}</div>'
            + f'<div style="margin-top: 12px">{segmented(names, -1)}</div>'
            + f'<div style="margin-top: 12px">{numfield(lab, value, state=field_state, auto=auto, w=280)}</div>'
            + f'<div style="margin-top: 10px">{muted("Тяните подпись или используйте стрелки · Двойной щелчок по границе — авто")}</div>')


# ── frames ───────────────────────────────────────────────────────────────────────

COLS = [("Задача", 220), ("Ответственный", 200), ("Срок", 150)]
ROWS = [("Этап 1", 150), ("Этап 2", 150)]


def filled(g):
    out = sticky(*g.cell(0, 0), "Собрать макет") + sticky(*g.cell(1, 0), "Аня", 80, 80) + sticky(*g.cell(2, 0), "12.11", 80, 80, OR)
    out += sticky(*g.cell(0, 1), "Проверить вёрстку", 110, 96, BL) + sticky(*g.cell(1, 1), "Илья", 80, 80)
    return out


def s1():
    b = chrome()
    g = Grid(150, 160, [("Задача", 220), ("Ответственный", 245), ("Срок", 150)], ROWS)
    b += g.draw() + filled(g)
    x = g.cx[2]
    b += vline(x, g.y, g.hh, width=2) + vline(x, g.y, g.h, dashed=True, z=7) + cursor(x, g.y + 20, "col") + chip(x + 14, g.y - 28, "245 px · Вручную")
    b += note(g.x, g.y + g.h + 24, "Внутренняя граница «Ответственный | Срок»: тянется так же, как крайняя. Порог 3 px; во время drag — чип у указателя и пунктир через всю таблицу. Отпускание — один undo, Esc — вернуть прежний размер.", 420)
    g2 = Grid(820, 600, [("Задача", 150), ("Ответственный", 150)], [("Этап 1", 112), ("Этап 2", 88)], title="Строка: та же ручка в полосе имён")
    b += g2.draw()
    y = g2.ry[1]
    b += hline(g2.x, y, g2.hw, width=2) + hline(g2.x, y, g2.w, dashed=True, z=7) + cursor(g2.x + 64, y, "row") + chip(g2.x + 80, y + 10, "112 px · Вручную")
    # §10.1, owner-approved: with Alt/Option held, an inner border in the body is a handle too.
    g3 = Grid(960, 170, [("Задача", 150), ("Срок", 120)], [("Этап 1", 112), ("Этап 2", 112)], title="Alt/Option: граница из тела таблицы")
    b += g3.draw() + sticky(*g3.cell(0, 0), "Собрать макет", 100, 80)
    x3, cy = g3.cx[1], g3.ry[1] + 50
    b += vline(x3, g3.y, g3.h, width=2) + cursor(x3, cy, "col") + chip(x3 + 14, cy - 34, "150 px · Вручную")
    b += (f'<span aria-hidden="true" style="position: absolute; left: {x3 + 14}px; top: {cy + 14}px; height: 20px; min-width: 20px; padding: 0 6px; box-sizing: border-box; '
          f'border: 1px solid {P["strong"]}; border-bottom-width: 2px; border-radius: 6px; background: {P["panel"]}; font-size: 11px; font-weight: 600; '
          f'display: inline-flex; align-items: center; z-index: 9">Alt</span>')
    b += note(g3.x, g3.y + g3.h + 20, "Пока Alt/Option зажат, внутренние линии тела — тоже ручки (зона 12 px, курсор ресайза), линия видна на всю высоту сплошной 2 px. Без Alt тело — выбор ячейки и перенос объектов, как раньше. Alt отпущен во время drag — drag продолжается до отпускания кнопки. На касании варианта нет.", 400)
    return b


frame("S1", "axis-drag", "size / axis-drag — граница оси", s1(),
      ["Тянется любая граница в полосе заголовков (колонки) и в полосе имён (строки), не только крайняя.",
       "Hover: линия border-focus 1 px на высоту шапки; drag: 2 px, пунктир через таблицу, чип «245 px · Вручную» (bg-inverse).",
       "После отпускания ось — «Вручную»; содержимое может её только увеличить (ADR-206).",
       "Решение §10.1 (подтверждено владельцем): в теле таблицы граница тянется только с зажатым Alt/Option; без модификатора тело — выбор и перенос."])


def s2():
    b = chrome()
    states = [("Покой", dict(field_state="rest")), ("Hover подписи", dict(field_state="hover")),
              ("Drag подписи · живое превью", dict(field_state="drag", value=268)), ("Фокус · набор", dict(field_state="focus", value=245)),
              ("Авто", dict(mode=0, auto=True, field_state="rest"))]
    pos = [(110, 130), (500, 130), (890, 130), (110, 510), (500, 510)]
    for (t, kw), (x, y) in zip(states, pos):
        b += caption(x, y - 22, t)
        body = axis_popover_body(**kw)
        if t.startswith("Фокус"):
            body = body.replace('<span style="font-variant-numeric: tabular-nums">245</span>', '<span style="font-variant-numeric: tabular-nums">245</span><span style="display: inline-block; width: 1.5px; height: 15px; background: currentColor; vertical-align: -2px"></span>')
        b += popover(x, y, "Ширина колонки «Ответственный»", body, z=8)
    b += cursor(546, 334, "scrub") + cursor(936, 334, "scrub") + chip(930, 300, "268 px")
    b += note(890, 520, "Подпись поля — «скраб»: тяните вправо/влево, 1 px = 1 px, Shift — ×10, Alt — точнее; таблица на холсте меняется вживую. Клик по значению ставит каретку: ввод не отбирается перетаскиванием. Enter — зафиксировать, Esc — вернуть, пусто — Авто.", 330)
    return b


frame("S2", "axis-popover", "size / axis-popover — поповер оси", s2(),
      ["Состояния: покой, hover подписи (курсор ew-resize, пунктирное подчёркивание), drag (живое значение + превью на холсте), фокус с кареткой, «Авто» (поле пусто).",
       "Порядок: режим Авто/Вручную → пресеты → числовое поле → подсказка клавиш. Пресеты — способ задать ручной размер, не третье состояние.",
       "Степперы −/+ появляются по hover/focus; ввод с клавиатуры всегда работает."])


def corner(g, seg=None, drag=None, focus=None):
    """The header corner: bottom edge = header height, right edge = header width."""
    out = ""
    x0, y0 = g.x, g.y
    if seg == "bottom":
        out += hline(x0, y0 + g.hh, g.hw, width=2) + hline(x0, y0 + g.hh, g.w, dashed=True, z=7)
    if seg == "right":
        out += vline(x0 + g.hw, y0, g.hh, width=2) + vline(x0 + g.hw, y0, g.h, dashed=True, z=7)
    grip = (f'<span aria-hidden="true" style="position: absolute; left: {x0 + g.hw - 20}px; top: {y0 + g.hh - 20}px; width: 20px; height: 20px; '
            f'border-radius: 6px; background: {P["panel"]}; border: 1px solid {P["strong"]}; box-sizing: border-box; display: flex; align-items: center; justify-content: center; z-index: 8">'
            f'<svg width="12" height="12" viewBox="0 0 12 12"><path d="M11 3 V11 H3" fill="none" stroke="{P["ink"]}" stroke-width="1.5" stroke-linecap="round"/></svg></span>')
    out += grip
    if focus:
        out += focus_ring(x0 + g.hw - 20, y0 + g.hh - 20, 20, 20, 7)
    return out


def s3():
    b = chrome()
    g = Grid(150, 170, COLS, ROWS, hh=64, heads={("c", 1): "Ответственный<br>за этап"})
    b += g.draw() + filled(g) + corner(g, seg="bottom") + cursor(g.x + 60, g.y + g.hh, "row") + chip(g.x + 76, g.y + g.hh + 8, "Высота шапки · 64 px")
    b += note(g.x, g.y + g.h + 24, "Hover нижней границы угла: попадание только в шапке (на ширину полосы имён), но вся линия через таблицу подсвечена как направляющая. Клик у края ячейки «Этап 1 × Задача» выбирает ячейку, а не тянет шапку.", 430)
    g2 = Grid(930, 170, [("Задача", 150), ("Срок", 110)], ROWS, hw=176, heads={("r", 0): "Этап 1 — подготовка"})
    b += g2.draw() + corner(g2, seg="right") + cursor(g2.x + g2.hw, g2.y + 22, "col") + chip(g2.x + g2.hw + 12, g2.y - 28, "Ширина шапки · 176 px")
    b += note(930, g2.y + g2.h + 24, "Правая граница угла — ширина полосы имён строк. Верх и лево угла — края раздела, они не тянутся. Двойной щелчок по сегменту — Авто для этой величины, по углу — обе в Авто.", 420)
    b += caption(930, 640, "Клавиатура: угол — два separator") + at(930, 666, f'<div style="display: flex; gap: 10px">{btn("Высота шапки · 64", "quiet", 30)}{btn("Ширина шапки · Авто", "quiet", 30)}</div>')
    return b


frame("S3", "band-corner", "size / band-corner — угол шапки", s3(),
      ["Угол — элемент хрома, не ячейка: не выбирается, не входит в диапазон, объединение, drop и таблицу для скринридера.",
       "Нижняя граница угла — высота шапки (общая для таблицы), правая — ширина полосы имён. Захват 20×20 (--table-band-grip) в правом нижнем углу.",
       "Полная линия через таблицу — только направляющая; попадание живёт в пределах шапки, клики по ячейкам свободны.",
       "Авто: высота — по самым высоким заголовкам с переносами, ширина — по самому длинному имени строки; потолок 260 px."])


def size_panel(x, y, disabled=False, axis="col", value=245, mode=1, hh_val=None, hw_val=None):
    lab = "Ширина колонки «Ответственный»" if axis == "col" else "Высота строки «Этап 1»"
    names = ["Узкая", "Средняя", "Широкая"] if axis == "col" else ["Низкая", "Средняя", "Высокая"]
    inner = (f'<div style="font-size: 12px; font-weight: 600; letter-spacing: .06em; color: {P["muted"]}">РАЗМЕР</div>'
             f'<div style="margin-top: 10px; font-size: 13px; font-weight: 600">{lab}</div>'
             f'<div style="margin-top: 10px">{segmented(["Авто", "Вручную"], mode, disabled=disabled)}</div>'
             f'<div style="margin-top: 6px">{muted("Растёт под содержимое, но не сжимается само.")}</div>'
             f'<div style="margin-top: 10px">{segmented(names, -1, disabled=disabled)}</div>'
             f'<div style="margin-top: 12px">{numfield("Ширина" if axis == "col" else "Высота", value, disabled=disabled, w=296)}</div>'
             f'<div style="height: 1px; background: {P["line"]}; margin: 18px 0 14px"></div>'
             f'<div style="display: flex; align-items: baseline; gap: 8px"><span style="font-size: 13px; font-weight: 600">Шапка</span>'
             f'<span style="font-size: 12px; color: {P["muted"]}">общая для таблицы</span></div>'
             f'<div style="margin-top: 10px">{numfield("Высота шапки", hh_val or 0, auto=hh_val is None, disabled=disabled, w=296)}</div>'
             f'<div style="margin-top: 8px">{numfield("Ширина шапки", hw_val or 0, auto=hw_val is None, disabled=disabled, w=296)}</div>'
             f'<div style="margin-top: 8px">{muted("Пусто — авто по тексту заголовков.")}</div>')
    if disabled:
        inner += (f'<div style="margin-top: 14px; display: flex; gap: 8px; align-items: center; font-size: 12px; color: {P["text2"]}">'
                  f'{ic("lock-on", 16)}Раздел заблокирован — размеры не меняются</div>')
    return panel(x, y, 344, inner, pad="18px 20px")


def s4():
    b = chrome()
    g = Grid(150, 170, COLS, ROWS)
    b += g.draw() + filled(g) + vline(g.cx[2], g.y, g.hh, width=2)
    b += size_panel(1050, 96)
    b += note(150, 560, "Поля «Шапка» и ручки угла — одна команда (setTableHeaderSize); поле размера оси и ручка границы — одна команда. Кнопка размера в панели открывает тот же поповер, что меню заголовка.", 420)
    b += note(150, 650, "Disabled-вариант — в кадре S9 «locked».", 420)
    return b


frame("S4", "panel", "size / panel — группа «Размер»", s4(),
      ["Порядок: режим оси → пресеты → числовое поле → подпись-связка «Ширина колонки» → подгруппа «Шапка» (общая для таблицы).",
       "Поля шапки: пусто = Авто, плейсхолдер «Авто»; сброс — очистить поле.",
       "Значения панели, поповера и ручек на холсте всегда совпадают: это одни и те же команды."])


def editor(x, y, w, lines, vertical=False):
    text = "<br>".join(lines)
    caret = f'<span style="display: inline-block; width: 1.5px; height: 15px; background: {P["ink"]}; vertical-align: -2px"></span>'
    return (f'<div style="position: absolute; left: {x}px; top: {y}px; width: {w}px; box-sizing: border-box; padding: 9px 10px; border: 1.5px solid {P["focus"]}; '
            f'border-radius: 6px; background: {P["panel"]}; font-size: 13px; line-height: 16px; font-weight: 600; z-index: 9">{text}{caret}'
            f'<div style="margin-top: 8px; font-size: 11px; font-weight: 400; color: {P["muted"]}">Enter — готово · Shift+Enter — новая строка</div></div>')


def s5():
    b = chrome()
    for k, (lines, x) in enumerate([(["Ответственный"], 110), (["Ответственный", "за этап"], 530), (["Ответственный", "за этап", "(основной)"], 950)]):
        g = Grid(x, 180, [("Задача", 100), (" ", 190)], [("Этап 1", 100)], hw=96, hh=40 + 16 * (len(lines) - 1), title=f"{len(lines)} строк{'а' if len(lines) == 1 else 'и'}")
        b += g.draw()
        b += editor(g.cx[1] + 2, g.y + 2, 186, lines)
    g = Grid(110, 470, [("Задача", 100), ("V", 56)], [("Этап 1", 100)], hw=96, hh=120, title="Вертикальный заголовок")
    b += g.draw().replace('font-weight: 600; ">V</div>', 'font-weight: 600; ">&nbsp;</div>')
    b += (f'<div style="position: absolute; left: {g.cx[1] + 6}px; top: {g.y + 112}px; transform: rotate(-90deg); transform-origin: left top; width: 110px; '
          f'font-size: 13px; line-height: 16px; font-weight: 600; z-index: 3">Срок<br>сдачи</div>')
    b += note(530, 420, "Редактор на холсте — текстовое поле на 2–6 строк, растёт по тексту. Enter — готово, Shift+Enter и Alt/Option+Enter — перенос, Esc — отмена, Tab — следующий заголовок. Подсказка внизу редактора — тихая, 11 px text-muted, видна только в режиме правки.", 520)
    b += note(110, 720, "Вертикальный заголовок укладывает строки поперёк полосы: каждая строка — отдельная колонка текста. Шапка растёт по самому длинному заголовку (потолок 260 px).", 420)
    return b


frame("S5", "multiline-edit", "header / multiline-edit — редактор на холсте", s5(),
      ["1, 2 и 3 строки: шапка в Авто растёт на 16 px за строку (line-height заголовка).",
       "Перенос — обычный символ документа: на холсте, в панели и в экспорте одинаково.",
       "Без жирного/курсива/цвета: это подпись оси, а не объект."])


def s6():
    b = chrome()
    g = Grid(150, 200, [("Задача", 200), ("Ответственный<br>за этап", 200), ("Срок", 150)], ROWS, hh=56)
    b += g.draw() + filled(g)
    lst = ""
    for t, tag, on in [("Задача", "", False), ("Ответственный", "2 строки", True), ("Срок", "", False)]:
        lst += (f'<div title="Ответственный&#10;за этап" style="display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 12px; border-radius: 12px; '
                f'{"background: " + P["hover"] + ";" if on else ""} font-size: 13px">{t}<span style="flex: 1"></span>'
                f'{"<span style=\"font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid " + P["strong"] + "; color: " + P["text2"] + "\">" + tag + "</span>" if tag else ""}</div>')
    field = (f'<div style="font-size: 13px; font-weight: 500; margin-bottom: 6px">Название колонки</div>'
             f'<div style="box-sizing: border-box; min-height: 60px; padding: 8px 12px; border: 2px solid {P["focus"]}; border-radius: 14px; font-size: 13px; line-height: 18px">'
             f'Ответственный<br>за этап<span style="display: inline-block; width: 1.5px; height: 15px; background: {P["ink"]}; vertical-align: -2px"></span></div>'
             f'<div style="margin-top: 6px">{muted("Shift+Enter — новая строка · Enter — готово")}</div>')
    inner = (f'<div style="font-size: 12px; font-weight: 600; letter-spacing: .06em; color: {P["muted"]}">КОЛОНКИ</div><div style="margin-top: 8px">{lst}</div>'
             f'<div style="height: 1px; background: {P["line"]}; margin: 14px 0"></div>{field}')
    b += panel(1050, 96, 344, inner)
    b += note(150, 600, "Поле названия оси в панели — многострочное (минимум 2 строки), те же клавиши, что на холсте. В списке осей — первая строка и метка «2 строки»; полный текст — в подсказке при наведении.", 460)
    return b


frame("S6", "multiline-panel", "header / multiline-panel — заголовок в панели", s6(),
      ["Однострочный Input заменяется многострочным полем ≥ 2 строк; переносы сохраняются.",
       "Метка «{n} строки» — тихая пилюля в строке списка осей (text-secondary, контур border-strong).",
       "Скринридер читает заголовок как текст с переносами, без лишних объявлений."])


def s7():
    b = chrome()
    long = "Ответственный за этап<br>и согласование<br>с заказчиком"
    g = Grid(150, 200, [("Задача", 180), ("Ответственный", 200), ("Срок", 120)], ROWS, hh=72, heads={("c", 1): long}, title="Авто: шапка выросла под 3 строки")
    b += g.draw() + filled(g) + chip(g.x + g.w + 12, g.y + 26, "Высота шапки · Авто · 72 px")
    g2 = Grid(150, 640, [("Задача", 180), ("Ответственный", 200), ("Срок", 120)], [("Этап 1", 110)], hh=40, heads={("c", 1): (long, 1)}, title="Вручную 40 px: многоточие, текст не сжимается")
    b += g2.draw() + chip(g2.x + g2.w + 12, g2.y + 10, "Высота шапки · 40 px · Вручную")
    b += note(1030, 220, "Авто: высота шапки = самая высокая шапка с учётом переносов и вертикальных заголовков, потолок 260 px.", 360)
    b += note(1030, 650, "Ручной размер точный: не влезающее сокращается многоточием; кегль не уменьшается, текст не масштабируется. Полный текст — в подсказке и в панели.", 360)
    return b


frame("S7", "auto-vs-manual", "header / auto-vs-manual — Авто и ручная шапка", s7(),
      ["Один и тот же трёхстрочный заголовок: в Авто шапка 72 px, вручную 40 px — первая строка и «…».",
       "Объекты в ячейках не затронуты: меняется только полоса шапки."])


def s8():
    b = header() + rail() + zoom("50 % · 200 %")
    g = Grid(150, 200, COLS, ROWS, s=.5, title="50 %")
    b += g.draw(13) + vline(g.cx[2], g.y, g.hh, width=2) + vline(g.cx[2], g.y, g.h, dashed=True, z=7) + cursor(g.cx[2], g.y + 10, "col") + chip(g.cx[2] + 14, g.y - 28, "245 px")
    g2 = Grid(560, 200, [("Задача", 220), ("Ответственный", 245)], [("Этап 1", 150)], s=1.6, title="200 % (фрагмент)")
    b += g2.draw(13) + vline(g2.cx[1], g2.y, g2.hh, width=2) + vline(g2.cx[1], g2.y, g2.h, dashed=True, z=7) + cursor(g2.cx[1], g2.y + 30, "col") + chip(g2.cx[1] + 14, g2.y - 28, "220 px")
    b += note(150, 560, "Ручка, линия hover, чип и кольцо фокуса — в экранных px: на 50 % и 200 % они одного размера; масштабируется только таблица. Попадание — 12 px в обе стороны от линии при любом зуме.", 520)
    return b


frame("S8", "zoom", "size / zoom — 50 % и 200 %", s8(),
      ["Хром стабилен: 1 px линия, 2 px во время drag, чип 20 px, попадание 12/24 px — одинаково на любом масштабе.",
       "На 50 % ручка не исчезает, пока граница видна; на 200 % чип не растёт вместе с текстом таблицы."])


def s9():
    b = chrome()
    g = Grid(150, 170, COLS, ROWS)
    b += g.draw() + filled(g)
    b += (f'<div style="position: absolute; left: {g.x + g.w - 26}px; top: {g.y - 26}px; color: {P["ink"]}; z-index: 4">{ic("lock-on", 16)}</div>')
    b += cursor(g.cx[2], g.y + 20, "scrub").replace("<svg", '<svg style="opacity:0"') + note(g.x, g.y + g.h + 24, "Раздел заблокирован или у вас роль «Просмотр»: ручки границ и угла не показываются, курсор не меняется. Причина — словами в панели, не только серым цветом.", 430)
    b += size_panel(1050, 96, disabled=True)
    return b


frame("S9", "locked", "size / locked — только чтение", s9(),
      ["Ручки скрыты; поля и сегменты — disabled с причиной «Раздел заблокирован — размеры не меняются».",
       "Для роли «Просмотр» та же картина, причина — «Вы можете просматривать»."])


def s10():
    b = ""
    b += f'<h1 style="position: absolute; left: 60px; top: 40px; font-size: 24px; font-weight: 600; margin: 0">NumberField — числовое поле таблицы</h1>'
    b += at(60, 76, muted("Один контрол для размера оси, высоты и ширины шапки, толщины рамки и отступа. Грубо — рукой (скраб), точно — числом.", 14), 900)
    # anatomy
    b += caption(60, 128, "Анатомия")
    b += at(60, 156, numfield("Ширина", 245, state="hover", w=360))
    b += at(60, 196, muted("1 подпись-скраб (ew-resize) · 2 значение, tabular-nums · 3 единица · 4 степперы −/+ по hover/focus", 11), 420)
    b += at(500, 156, numfield("Высота шапки", 0, auto=True, w=330)) + at(500, 196, muted("5 «Авто» = пустое поле с плейсхолдером", 11), 330)
    states = [("Покой", dict(state="rest")), ("Hover", dict(state="hover")), ("Drag подписи", dict(state="drag", value=268)),
              ("Фокус · набор", dict(state="focus", typing=True)), ("Авто", dict(auto=True)), ("Вне диапазона", dict(state="focus", value=2400, error="Применено 2 400 — максимум для колонки")),
              ("Disabled", dict(disabled=True)), ("Касание 44 px", dict(state="hover", touch=True))]
    b += caption(60, 240, "Состояния")
    for k, (t, kw) in enumerate(states):
        col, row = k % 2, k // 2
        x, y = 60 + col * 460, 270 + row * 92
        b += f'<div style="position: absolute; left: {x}px; top: {y}px; font-size: 12px; font-weight: 600">{t}</div>'
        b += at(x, y + 22, numfield("Ширина", kw.pop("value", 245), w=380, **kw))
    b += cursor(86, 400, "scrub") + chip(60, 368, "268 px")
    b += panel(1000, 128, 380,
               f'<div style="font-size: 13px; font-weight: 600">Поведение</div>'
               + "".join(f'<div style="margin-top: 8px">{muted(t, 12, P["text2"])}</div>' for t in [
                   "Тянуть подпись: 1 px указателя = 1 px; Shift — ×10; Alt/Option — точнее.",
                   "Живое превью на холсте; фиксация на отпускании — один undo; Esc возвращает прежнее.",
                   "↑/↓ — 1, Shift+↑/↓ — 10, Home/End — минимум/максимум, Enter — зафиксировать, Esc — отменить, пусто — Авто.",
                   "Клик по значению ставит каретку: ввод не отбирается перетаскиванием.",
                   "Вне диапазона — не зажимаем молча: показываем применённое значение и границу.",
                   "Границы: колонка 120–2400, строка 72–2400, шапка 64–2000 / 40–2000, рамка 1–8, отступ 0–96.",
                   "После фиксации, если режим стал «Вручную», — тихое сообщение «Размер задан вручную»."]),
               radius=20)
    return b


frame("S10", "number-field", "components / number-field", s10(),
      ["Компонент @remo/ui (заменяет табличные Input): подпись-скраб, значение, единица, степперы, «Авто».",
       "Все состояния — в этом кадре; тёмная тема — в тёмном двойнике; касание — высота 44, степперы 36."], )


def s11():
    b = f'<h1 style="position: absolute; left: 60px; top: 40px; font-size: 24px; font-weight: 600; margin: 0">ResizeHandle и BandGrip</h1>'
    g = Grid(90, 160, [("Задача", 180), ("Ответственный", 200)], [("Этап 1", 120), ("Этап 2", 100)], title="")
    b += g.draw()
    x = g.cx[1]
    b += hit_zone(x - 12, g.y, 24, g.hh) + vline(x, g.y, g.hh, width=1) + cursor(x, g.y + 20, "col")
    y = g.ry[1]
    b += hit_zone(g.x, y - 12, g.hw, 24) + hline(g.x, y, g.hw, width=1) + cursor(g.x + 60, y, "row")
    b += note(90, g.y + g.h + 20, "Попадание 12 px в обе стороны от линии (24 на касании) — --table-handle-hit. Ручка выше заголовков; вне полосы попадания заголовок кликается как обычно. Курсоры col-resize / row-resize.", 470)
    b += caption(90, 560, "Фокус с клавиатуры: role=separator")
    b += at(90, 590, f'<div style="position: relative; width: 300px; height: 40px; background: {P["head"]}; border: 1px solid {P["line"]}; border-radius: 4px"></div>')
    b += vline(240, 590, 40, width=2) + focus_ring(234, 588, 12, 44, 4)
    b += note(360, 590, "Tab — к ручке; ←/→ (↑/↓) — 8 px, Shift — 40 px, Delete — Авто. aria-valuenow = текущий размер, aria-label «Ширина колонки «Ответственный»».", 330)
    g2 = Grid(820, 160, [("Задача", 180)], [("Этап 1", 120)], hh=64, title="")
    b += g2.draw()
    b += hit_zone(g2.x, g2.y + g2.hh - 12, g2.hw, 24) + hit_zone(g2.x + g2.hw - 12, g2.y, 24, g2.hh)
    b += corner(g2, focus=True)
    b += note(820, g2.y + g2.h + 20, "BandGrip — угол шапки: захват 20×20 (--table-band-grip) + два сегмента попадания: низ угла (высота шапки) и право угла (ширина полосы имён). Фокус — на захвате; ↑/↓ — высота, ←/→ — ширина.", 470)
    return b


frame("S11", "handle-grip", "components / resize-handle и band-grip", s11(),
      ["Зоны попадания показаны голубой штриховкой (только в спецификации, в продукте не рисуются).",
       "Касание: 24 px, без hover-зависимых действий; ручка шапки на касании — длинное нажатие на угол (§10.5, проверить на прототипе)."])


def s12():
    b = f'<h1 style="position: absolute; left: 60px; top: 40px; font-size: 24px; font-weight: 600; margin: 0">Redlines</h1>'
    rows = [
        ("Линия границы, hover", "1 px, border-focus, на высоту шапки / ширину полосы имён"),
        ("Линия границы, drag", "2 px border-focus + направляющая 1 px пунктир 5/4 через таблицу"),
        ("Попадание", "12 px в обе стороны (24 на касании) — --table-handle-hit (новый)"),
        ("Порог drag", "3 px; меньше — клик по заголовку"),
        ("Чип значения", "h 20, радиус radius-sm 6, отступ 7, bg-inverse / text-inverse, type-caption; 14 px справа и 28 px выше указателя"),
        ("Захват угла", "20×20, радиус 6, bg-panel, контур border-strong 1 — --table-band-grip (новый)"),
        ("Кольцо фокуса", "2 px border-focus, offset 2"),
        ("Числовое поле", "h 32 (касание 44), радиус pill, контур border-strong 1 / focus 2; степперы 24 (36)"),
        ("Z-порядок над холстом", "таблица → заголовки → ручки границ и угла → чип → поповер (z-popover)"),
        ("Зум", "все элементы этого списка — в экранных px; таблица масштабируется, хром — нет"),
        ("Движение", "появление линии и чипа 120 мс (dur-1), без пружин; reduced motion — мгновенно"),
    ]
    head = f'<tr><th style="text-align: left; padding: 8px 12px; font-size: 12px; color: {P["muted"]}; border-bottom: 1px solid {P["line"]}">Элемент</th><th style="text-align: left; padding: 8px 12px; font-size: 12px; color: {P["muted"]}; border-bottom: 1px solid {P["line"]}">Метрика и токен</th></tr>'
    body = "".join(f'<tr><td style="padding: 9px 12px; font-size: 13px; font-weight: 500; border-bottom: 1px solid {P["line"]}; width: 260px">{a}</td><td style="padding: 9px 12px; font-size: 13px; border-bottom: 1px solid {P["line"]}">{c}</td></tr>' for a, c in rows)
    b += f'<table style="position: absolute; left: 60px; top: 90px; width: 1320px; border-collapse: collapse">{head}{body}</table>'
    return b


frame("S12", "redlines", "99 Redlines", s12(),
      ["Метрики, z-порядок, зум и движение. Новые токены — два: --table-handle-hit (12 / 24) и --table-band-grip (20).",
       "Цвета — только существующие: border-focus, bg-inverse, text-inverse, border-strong, bg-panel."])


def s13():
    b = f'<h1 style="position: absolute; left: 60px; top: 40px; font-size: 24px; font-weight: 600; margin: 0">Решения по открытым вопросам §10</h1>'
    rows = [
        ("1. Ресайз из тела таблицы", "<b>Только с Alt/Option</b> (подтверждено владельцем). Без модификатора — нет; на касании — нет", "Тело таблицы — выбор ячейки и перенос объектов; без модификатора второй жест на тех же пикселях ломает оба. Alt разводит жесты; см. S1."),
        ("2. Мультивыбор осей", "<b>Отдельная задача</b>", "Модель выбирает одну ось; общая дельта для выбранных — после ADR."),
        ("3. Магнит", "<b>Нет</b>, кроме шага Shift = 40 px", "Пресеты уже дают «ровные» размеры; магнит к 8 px мешает точной подгонке под объект."),
        ("4. Подсказка первого раза", "<b>Да, в панели</b>: «Тяните границу, чтобы изменить размер · Двойной щелчок — авто», один раз", "На холсте подсказка спорит с содержимым; панель открыта как раз тогда, когда человек думает о размере."),
        ("5. Шапка на касании", "<b>Длинное нажатие на угол</b> → те же два separator крупно (24 px)", "Двумя пальцами — зум холста; конфликт жестов. Проверить на прототипе."),
        ("Подсказка Shift+Enter", "<b>Внизу редактора</b>, 11 px text-muted, только в режиме правки", "Там, где человек печатает; вне правки не шумит."),
        ("«Высота колонки» / «ширина строки»", "<b>Не используем</b>. Пишем «Высота шапки», «Ширина шапки» (общие)", "Честные имена: у отдельной колонки нет своей высоты."),
    ]
    head = "".join(f'<th style="text-align: left; padding: 8px 12px; font-size: 12px; color: {P["muted"]}; border-bottom: 1px solid {P["line"]}">{c}</th>' for c in ["Вопрос", "Решение", "Причина"])
    body = "".join("<tr>" + "".join(f'<td style="padding: 9px 12px; font-size: 13px; line-height: 18px; border-bottom: 1px solid {P["line"]}; vertical-align: top">{c}</td>' for c in r) + "</tr>" for r in rows)
    b += f'<table style="position: absolute; left: 60px; top: 90px; width: 1320px; border-collapse: collapse"><tr>{head}</tr>{body}</table>'
    return b


frame("S13", "decisions", "Решения §10", s13(), ["Рекомендации дизайна по открытым вопросам ТЗ; пункт 1 подтверждён владельцем: Alt/Option-вариант."])


for name, title, html in BOARDS:
    open(os.path.join(OUT, f"{name}.dc.html"), "w").write(html)
json.dump({"boards": [[n, t] for n, t, _ in BOARDS], "notes": NOTES, "series": SERIES},
          open(os.path.join(OUT, f"_notes-{THEME}.json"), "w"), ensure_ascii=False)
print(len(BOARDS))
