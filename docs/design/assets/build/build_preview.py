"""Overview sheet for the asset set: every icon at 24/20/16 on panel, canvas and dark,
a grayscale strip, cursors on three grounds, marks and the participant cursor.
Usage: python3 -I build_preview.py <assets_dir>
"""
import json, os, sys

A = sys.argv[1]
icons = json.load(open(f"{A}/icons/icons.json"))
cursors = json.load(open(f"{A}/cursors/cursors.json"))


def inline(name, size, sw):
    x = icons[name]
    body = ""
    if x["d"]:
        body += f'<path d="{x["d"]}" fill="none" stroke="currentColor" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"/>'
    if x.get("fill"):
        body += f'<path d="{x["fill"]}" fill="currentColor" fill-rule="evenodd"/>'
    return f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" aria-hidden="true">{body}</svg>'


def inline16(name, cls=""):
    x = icons[name]
    body = ""
    if x.get("d16"):
        body += f'<path d="{x["d16"]}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
    if x.get("fill16"):
        body += f'<path d="{x["fill16"]}" fill="currentColor" fill-rule="evenodd"/>'
    return f'<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">{body}</svg>'


groups = {}
for k, v in icons.items():
    groups.setdefault(v["group"], []).append(k)

cells = []
for g, names in groups.items():
    cells.append(f'<h2>{g} · {len(names)}</h2><div class="grid">')
    for k in names:
        cells.append(
            f'<figure title="{icons[k]["meaning"]}"><div class="row">'
            f'<span class="big">{inline(k, 48, 2)}</span>'
            f'<span>{inline(k, 24, 2)}</span><span>{inline(k, 20, 2)}</span><span>{inline16(k)}</span>'
            f'<span class="cv">{inline16(k)}</span><span class="dk">{inline16(k)}</span></div>'
            f'<figcaption>{k}</figcaption></figure>')
    cells.append("</div>")

curs = []
for k, m in cursors.items():
    svg = open(f"{A}/cursors/remo-cursor-{k}.svg").read()
    h = m["hotspot"]
    dot = f'<i class="hs" style="left:{h["x"] - 2}px;top:{h["y"] - 2}px"></i>'
    curs.append(f'<figure><div class="row">'
                f'<span class="cg">{svg}{dot}</span><span class="cg st">{svg}</span><span class="cg dkc">{svg}</span>'
                f'<span class="cg x2">{svg}</span></div><figcaption>{k} · {h["x"]},{h["y"]}</figcaption></figure>')

marks = "".join(f'<span class="mk">{open(f"{A}/marks/remo-mark-person-{s}.svg").read()}'
                f'{open(f"{A}/marks/remo-mark-agent-{s}.svg").read()}<small>{s}</small></span>' for s in (16, 18, 22, 28))
remote = open(f"{A}/cursors/remo-remote-cursor.svg").read()

html = f"""<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>REMO — иконки и курсоры</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600&display=swap">
<style>
:root{{--ink:#1E2136;--muted:#5A5D70;--canvas:#F3F2F0;--line:#E2E0DC}}
body{{margin:0;padding:32px 40px;font-family:"Golos Text",system-ui,sans-serif;color:var(--ink);background:#fff}}
h1{{font-size:24px;margin:0 0 4px}} h2{{font-size:15px;font-weight:600;margin:28px 0 10px}}
p{{margin:0;color:var(--muted);font-size:13px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:8px}}
figure{{margin:0;border:1px solid var(--line);border-radius:12px;padding:8px 10px;display:flex;flex-direction:column;gap:6px}}
figcaption{{font-size:12px;color:var(--muted)}}
.row{{display:flex;align-items:center;gap:8px}}
.row span{{display:flex;align-items:center;justify-content:center}}
.big{{width:56px;height:56px;background-image:linear-gradient(rgba(30,33,54,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(30,33,54,.06) 1px,transparent 1px);background-size:2px 2px;border-radius:6px}}
.cv{{background:var(--canvas);padding:4px;border-radius:4px}}
.dk{{background:#1B1D2B;color:#ECEDF3;padding:4px;border-radius:4px}}
.gray{{filter:grayscale(1)}}
.cg{{position:relative;width:40px;height:40px;background:var(--canvas);border-radius:6px}}
.cg svg{{position:absolute;left:4px;top:4px}} .st{{background:#E8DCCB}} .dkc{{background:#1B1D2B}}
.x2{{width:72px;height:72px}} .x2 svg{{width:64px;height:64px}}
.hs{{position:absolute;width:4px;height:4px;border-radius:2px;background:#E5484D;margin:4px 0 0 4px}}
.mk{{display:inline-flex;align-items:center;gap:10px;margin-right:24px}} .mk small{{color:var(--muted)}}
.scene{{background:var(--canvas);border-radius:12px;height:120px;position:relative;margin-top:8px}}
</style></head><body>
<h1>REMO · иконки, курсоры, метки</h1>
<p>Концепт v2: чернила #1E2136, линия 2 на 24 и 1.5 на 16 (своя сетка 16). В карточке: 48 (сетка 2 px), 24, 20, 16 на панели, холсте и тёмном фоне. Наведите на карточку — назначение.</p>
{''.join(cells)}
<h2>Градации серого: статусы, человек и агент</h2>
<div class="row gray">{''.join(inline(k, 24, 2) for k in ['status-todo','status-progress','status-done','status-overdue','saved','saving','offline','alert','error'])}
<span style="width:24px"></span>{open(f"{A}/marks/remo-mark-person-22.svg").read()}{open(f"{A}/marks/remo-mark-agent-22.svg").read()}</div>
<h2>Курсоры · холст, бумажный стикер, тёмный фон, @2x · красная точка — хот-спот</h2>
<div class="grid">{''.join(curs)}</div>
<h2>Метки: человек и агент · 16, 18, 22, 28</h2>
<div>{marks}</div>
<h2>Курсор участника</h2>
<div class="scene"><div style="position:absolute;left:120px;top:30px">{remote}</div>
<div style="position:absolute;left:520px;top:12px;transform:scale(2.5);transform-origin:0 0">{remote}</div>
<div style="position:absolute;left:300px;top:24px;width:76px;height:76px;background:#E8DCCB;border-radius:3px;box-shadow:0 6px 10px -4px rgba(60,40,20,.35);display:flex;align-items:center;justify-content:center;font-weight:600">US-3</div></div>
</body></html>
"""
open(f"{A}/preview.html", "w").write(html)
print("preview ok")
