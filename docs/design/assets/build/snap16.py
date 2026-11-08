"""Redraw 24-grid path data on a 16 grid for the small icon size.

A 1.5 px stroke cannot sit fully on pixels, so on-curve points go to quarter positions
(n + 0.25 or n + 0.75): the stroke then covers one whole pixel and half of the next one,
which is the crispest a 1.5 line gets. Those positions are symmetric around the icon
centre 8, and a point exactly on the centre stays there, so mirrored shapes stay mirrored.
Control points move with the end they belong to, so curves keep their tangents. Filled
shapes snap to half pixels, because a fill edge is crisp on whole and half positions.
"""
import re

K = 16 / 24
TOKEN = re.compile(r"[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?")
ARGS = {"M": 2, "L": 2, "H": 1, "V": 1, "C": 6, "S": 4, "Q": 4, "T": 2, "A": 7, "Z": 0}


def fmt(v):
    s = f"{v:.3f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def snap_stroke(v):
    v = v * K
    if abs(v - 8) < 0.2:
        return 8.0
    return round((v - 0.25) * 2) / 2 + 0.25


def snap_fill(v):
    return round(v * K * 2) / 2


def parse(d):
    """Yield absolute segments (cmd, [numbers]) with the current point resolved."""
    toks = TOKEN.findall(d)
    i, cmd, cx, cy, sx, sy = 0, None, 0.0, 0.0, 0.0, 0.0
    out = []
    while i < len(toks):
        t = toks[i]
        if t.isalpha():
            cmd = t
            i += 1
            if cmd in "Zz":
                out.append(("Z", []))
                cx, cy = sx, sy
                continue
        up, rel = cmd.upper(), cmd.islower()
        a = [float(x) for x in toks[i:i + ARGS[up]]]
        i += ARGS[up]
        if up == "H":
            a = [a[0] + (cx if rel else 0), cy]
            up = "L"
        elif up == "V":
            a = [cx, a[0] + (cy if rel else 0)]
            up = "L"
        elif up == "A":
            if rel:
                a[5] += cx
                a[6] += cy
        elif rel:
            a = [v + (cx if j % 2 == 0 else cy) for j, v in enumerate(a)]
        out.append((up, a))
        cx, cy = a[-2], a[-1]
        if up == "M":
            sx, sy = cx, cy
            cmd = "l" if rel else "L"  # implicit lineto after moveto
    return out


def to16(d, filled=False):
    if not d:
        return None
    snap = snap_fill if filled else snap_stroke
    res, dpx, dpy, res_x, res_y = [], 0.0, 0.0, 0.0, 0.0
    for cmd, a in parse(d):
        if cmd == "Z":
            res.append("Z")
            continue
        ex, ey = snap(a[-2]), snap(a[-1])
        dx, dy = ex - a[-2] * K, ey - a[-1] * K
        if cmd in ("M", "L", "T"):
            nums = [ex, ey]
        elif cmd == "C":
            nums = [a[0] * K + dpx, a[1] * K + dpy, a[2] * K + dx, a[3] * K + dy, ex, ey]
        elif cmd in ("S", "Q"):
            nums = [a[0] * K + dx, a[1] * K + dy, ex, ey]
        else:  # A: radii scale; quarter steps keep circles round on the grid
            rx, ry = max(.5, round(a[0] * K * 4) / 4), max(.5, round(a[1] * K * 4) / 4)
            qx, qy = abs(ex - (res_x)), abs(ey - (res_y))
            if not int(a[3]) and a[0] == a[1] and qx == qy and qx > 0:
                rx = ry = qx  # a snapped quarter corner keeps a true quarter circle
            nums = [rx, ry, a[2], int(a[3]), int(a[4]), ex, ey]
        res.append(cmd + " ".join(fmt(v) for v in nums))
        dpx, dpy = dx, dy
        res_x, res_y = ex, ey
    return "".join(res)
