"""REMO icon set (ADR-181; docs/design/assets/README.md).

Geometry is authored on a 24 grid as path data, the same shape as packages/ui/src/icons.ts,
so the set can replace ICONS by value. Usage: python3 -I build_icons.py <out_dir>
"""
import json, os, sys
from snap16 import to16

OUT = sys.argv[1]


def n(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def C(cx, cy, r):
    return f"M{n(cx - r)} {n(cy)}a{n(r)} {n(r)} 0 1 0 {n(2 * r)} 0a{n(r)} {n(r)} 0 1 0 {n(-2 * r)} 0z"


def E(cx, cy, rx, ry):
    return f"M{n(cx - rx)} {n(cy)}a{n(rx)} {n(ry)} 0 1 0 {n(2 * rx)} 0a{n(rx)} {n(ry)} 0 1 0 {n(-2 * rx)} 0z"


def R(x, y, w, h, r):
    return (f"M{n(x + r)} {n(y)}h{n(w - 2 * r)}a{n(r)} {n(r)} 0 0 1 {n(r)} {n(r)}v{n(h - 2 * r)}"
            f"a{n(r)} {n(r)} 0 0 1 {n(-r)} {n(r)}h{n(-(w - 2 * r))}a{n(r)} {n(r)} 0 0 1 {n(-r)} {n(-r)}"
            f"v{n(-(h - 2 * r))}a{n(r)} {n(r)} 0 0 1 {n(r)} {n(-r)}z")


def J(*parts):
    return "".join(parts)


CLOUD = "M7.5 18.5a4.5 4.5 0 0 1-.7-8.95A5.75 5.75 0 0 1 17.6 9.1a4.7 4.7 0 0 1-.6 9.4z"
EYE = "M2.5 12c2-4.2 5.5-6.5 9.5-6.5s7.5 2.3 9.5 6.5c-2 4.2-5.5 6.5-9.5 6.5S4.5 16.2 2.5 12z"
BACK_SHEET = "M15.5 8.5V6A2.5 2.5 0 0 0 13 3.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"
LOCK_BODY = R(5, 10.5, 14, 10, 3)

# name: (group, stroke path, fill path or None, meaning)
I = {}


def add(group, name, d, meaning, fill=None):
    I[name] = {"group": group, "d": d, "fill": fill, "meaning": meaning}


# 4.1 objects — silhouette first
g = "Объекты"
add(g, "sticky", J(R(4, 4, 16, 16, 2.5), "M8 9.5h8M8 13.5h5"), "стикер: квадратный лист с текстом")
add(g, "text", "M6 6.5V5h12v1.5M12 5v14M9.5 19h5", "текстовый объект, без рамки")
add(g, "shape", R(3.5, 5.5, 17, 13, 2), "фигура: пустой контур")
add(g, "shape-ellipse", E(12, 12, 8.5, 6.5), "эллипс")
add(g, "shape-diamond", "M12 3.5l8.5 8.5-8.5 8.5-8.5-8.5z", "ромб")
add(g, "frame", J(R(3.5, 8, 17, 12, 2), "M4 4.5h6.5"), "фрейм: рамка с подписью сверху слева")
add(g, "kanban", J(R(3.5, 4, 17, 16, 2.5), "M9.2 4v16M14.8 4v16M3.5 8.5h17"), "канбан: колонки и строка заголовков")
add(g, "card", J(R(3.5, 7, 17, 10, 2.5), "M7 9.8v4.4M10.5 12H17"), "карточка: полоса статуса слева")
add(g, "connector", J(C(6, 18, 2), C(18, 6, 2), "M7.6 16.4l8.8-8.8"), "связь: два узла и линия")
add(g, "connector-straight", "M5 19L19 5M13 5h6v6", "маршрут: прямая")
add(g, "connector-elbow", "M5 19v-7h14M15.5 8.5L19 12l-3.5 3.5", "маршрут: угловая")
add(g, "connector-curved", "M5 19c0-7 5-12 14-12M15.5 3.5L19 7l-3.5 3.5", "маршрут: кривая")
add(g, "group", J(R(6.5, 6.5, 7, 7, 1.5), R(10.5, 10.5, 7, 7, 1.5), "M3.5 6.5v-3h3M17.5 3.5h3v3M20.5 17.5v3h-3M6.5 20.5h-3v-3"), "группа: объекты в общей рамке")

# 4.2 rail
g = "Рельс"
add(g, "cursor", "M5.5 3.5l13 7.5-6 1.8-2.5 5.7z", "выбор")
add(g, "comment", "M6 4.5h12A2.5 2.5 0 0 1 20.5 7v7.5A2.5 2.5 0 0 1 18 17h-6.5L7 20.5V17H6a2.5 2.5 0 0 1-2.5-2.5V7A2.5 2.5 0 0 1 6 4.5z", "комментарий")
add(g, "undo", "M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11", "отменить")
add(g, "redo", "M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13", "повторить")
add(g, "palette", "M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.9 1.8-1.8 0-1.4-1.3-1.7-1.3-3 0-1 .8-1.7 1.8-1.7H17a3.5 3.5 0 0 0 3.5-3.5c0-3.9-3.8-7-8.5-7zM7.5 11.5h.01M9.5 7.5h.01M14.5 7.5h.01", "палитра")

# 4.3 text marks
g = "Текст"
add(g, "text-bold", "M7 4.5h5.75a3.75 3.75 0 0 1 0 7.5H7zM7 12h6.5a3.75 3.75 0 0 1 0 7.5H7z", "жирный")
add(g, "text-italic", "M10 4.5h8M6 19.5h8M14 4.5l-4 15", "курсив")
add(g, "text-underline", "M7 4v7a5 5 0 0 0 10 0V4M5.5 20h13", "подчёркнутый")
add(g, "text-strike", "M16.8 7.5c-.6-1.9-2.5-3-4.8-3-2.9 0-5 1.5-5 3.6 0 1.5 1 2.5 2.9 3.1M4.5 12h15M7.5 16.5c.6 1.9 2.4 3 4.6 3 2.9 0 5-1.5 5-3.6 0-.8-.3-1.5-.9-2.1", "зачёркнутый")
add(g, "align-left", "M4 6h16M4 10h10M4 14h16M4 18h10", "текст по левому краю")
add(g, "align-center", "M4 6h16M7 10h10M4 14h16M7 18h10", "текст по центру")
add(g, "align-right", "M4 6h16M10 10h10M4 14h16M10 18h10", "текст по правому краю")
add(g, "valign-top", "M4 4.5h16M8 9h8M8 12.5h5", "текст сверху")
add(g, "valign-middle", "M4 4.5h16M4 19.5h16M8 10.25h8M8 13.75h5", "текст по середине")
add(g, "valign-bottom", "M4 19.5h16M8 11.5h8M8 15h5", "текст снизу")
add(g, "text-size", "M3 7V5.5h10V7M8 5.5V19M14 12v-1h7v1M17.5 11v8", "размер текста; рядом всегда число")
add(g, "next-sticky", J(R(3.5, 6.5, 11, 11, 2), "M17 12h4.5M19 9.5l2.5 2.5-2.5 2.5"), "Tab — следующий стикер")

# 4.4 actions
g = "Действия"
add(g, "plus", "M12 5v14M5 12h14", "добавить")
add(g, "minus", "M5 12h14", "уменьшить")
add(g, "close", "M6 6l12 12M18 6L6 18", "закрыть")
add(g, "check", "M5 12.5l4.5 4.5L19 7", "готово")
add(g, "more", "M5 12h.01M12 12h.01M19 12h.01", "ещё")
add(g, "chevron-down", "M6 9l6 6 6-6", "раскрыть")
add(g, "chevron-right", "M9 6l6 6-6 6", "перейти")
add(g, "copy", J(R(8.5, 8.5, 12, 12, 2.5), BACK_SHEET), "копировать в буфер")
add(g, "duplicate", J(R(8.5, 8.5, 12, 12, 2.5), BACK_SHEET, "M14.5 12v5M12 14.5h5"), "дублировать на холсте")
add(g, "cut", J(C(6.5, 17.5, 2.5), C(17.5, 17.5, 2.5), "M8.3 15.7L18 4M15.7 15.7L6 4"), "вырезать")
add(g, "link", "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1", "ссылка")
add(g, "trash", "M4 7h16M9.5 7V5A1.5 1.5 0 0 1 11 3.5h2A1.5 1.5 0 0 1 14.5 5v2M6 7l1 11.5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2L18 7M10 11v5.5M14 11v5.5", "удалить объект")
add(g, "archive", J(R(3.5, 4, 17, 5, 1.5), "M5 9v8.5A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5V9M10 13h4"), "убрать комнату в корзину")
add(g, "pencil", "M4.5 19.5l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3l-10 10zM13.5 7l3 3", "изменить")
add(g, "lock", J(LOCK_BODY, "M8 10.5v-3a4 4 0 0 1 8 0v3"), "замок")
add(g, "lock-on", J(LOCK_BODY, "M8 10.5v-3a4 4 0 0 1 8 0v3"), "замок включён", fill=LOCK_BODY)
add(g, "unlock", J(LOCK_BODY, "M8 10.5v-3a4 4 0 0 1 7.7-1.5"), "снять замок")
add(g, "eye", J(EYE, C(12, 12, 2.75)), "показать")
add(g, "eye-on", EYE, "видно: включено, зрачок залит", fill=C(12, 12, 3.25))
add(g, "eye-off", J(EYE, C(12, 12, 2.75), "M4 4l16 16"), "скрыто")
add(g, "group-make", I["group"]["d"], "сгруппировать (тот же знак, что группа)")
add(g, "group-break", J(R(3.5, 3.5, 7, 7, 1.5), R(13.5, 13.5, 7, 7, 1.5), "M14 3.5h6.5V10M10 20.5H3.5V14"), "разгруппировать")
add(g, "layer-top", "M5 4h14M12 20V8M7.5 12.5L12 8l4.5 4.5", "на передний план")
add(g, "layer-up", "M12 19V6M7 11l5-5 5 5", "выше")
add(g, "layer-down", "M12 5v13M7 13l5 5 5-5", "ниже")
add(g, "layer-bottom", "M5 20h14M12 4v12M7.5 11.5L12 16l4.5-4.5", "на задний план")
add(g, "align-objects", J("M4 3.5v17", R(8, 6, 11, 4, 1.5), R(8, 14, 7, 4, 1.5)), "выровнять объекты")
add(g, "tidy", J(R(4, 4, 6, 6, 1.5), R(4, 14, 6, 6, 1.5), R(14, 4, 6, 6, 1.5), "M14 16.5V14h2.5M20 17.5V20h-2.5"), "упорядочить: четвёртое место ещё предложено")
add(g, "fit", J("M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15", R(8.5, 8.5, 7, 7, 1.5)), "вписать")
add(g, "tag", "M3.5 12.3V5A1.5 1.5 0 0 1 5 3.5h7.3a2 2 0 0 1 1.4.6l6.7 6.7a2 2 0 0 1 0 2.8l-6.6 6.6a2 2 0 0 1-2.8 0L4.1 13.7a2 2 0 0 1-.6-1.4zM8 8h.01", "теги")
add(g, "name", J(R(3, 8, 18, 8, 4), "M7.5 12h9"), "имя объекта: подпись-плашка")
add(g, "info", J(C(12, 12, 8.5), "M12 11v5M12 8h.01"), "сведения")
add(g, "search", J(C(11, 11, 6.5), "M20 20l-4.4-4.4"), "поиск")

# 4.5 room, navigation, access
g = "Комната и доступ"
add(g, "boards", J(R(4, 4, 7, 7, 2), R(13, 4, 7, 7, 2), R(4, 13, 7, 7, 2), R(13, 13, 7, 7, 2)), "все комнаты")
add(g, "home", "M4 10.5L12 4l8 6.5v8a2 2 0 0 1-2 2h-3.5v-6h-5v6H6a2 2 0 0 1-2-2z", "главная организации")
add(g, "apps", J(R(4, 4, 7, 7, 2), R(13, 4, 7, 7, 2), R(4, 13, 7, 7, 2), "M16.5 13v7M13 16.5h7"), "приложения")
add(g, "template", J(R(3.5, 3.5, 17, 17, 2.5), "M3.5 9h17M9 9v11.5"), "шаблоны")
add(g, "panel", J(R(3.5, 4, 17, 16, 2.5), "M15 4v16"), "панель свойств")
add(g, "settings", J("M4 7h9M17 7h3M4 17h3M11 17h9", C(15, 7, 2), C(9, 17, 2)), "настройки")
add(g, "sign-out", "M14 4.5h3.5A2.5 2.5 0 0 1 20 7v10a2.5 2.5 0 0 1-2.5 2.5H14M9.5 8l-4 4 4 4M5.5 12H15", "выйти из аккаунта")
add(g, "help", J(C(12, 12, 8.5), "M9.5 9.5a2.5 2.5 0 0 1 4.9.7c0 1.7-2.4 2.1-2.4 3.6M12 17h.01"), "справка")
add(g, "share", "M12 14V3.5M8 7.5l4-4 4 4M8 10.5H6.5A2.5 2.5 0 0 0 4 13v5a2.5 2.5 0 0 0 2.5 2.5h11A2.5 2.5 0 0 0 20 18v-5a2.5 2.5 0 0 0-2.5-2.5H16", "поделиться")
add(g, "download", "M12 4v11M7.5 10.5L12 15l4.5-4.5M4.5 19.5h15", "скачать, экспорт")
add(g, "upload", "M12 15V4M7.5 8.5L12 4l4.5 4.5M4.5 19.5h15", "загрузить, импорт")
add(g, "user", J(C(12, 8.5, 4), "M4.5 20.5a7.5 7.5 0 0 1 15 0"), "человек")
add(g, "users", J(C(9, 8.5, 3.5), "M2.5 20a6.5 6.5 0 0 1 13 0M15.5 5.2a3.5 3.5 0 0 1 0 6.6M18 14.2a6.5 6.5 0 0 1 3.5 5.8"), "участники")
add(g, "team", J(C(12, 7.5, 3), C(5.5, 10, 2.25), C(18.5, 10, 2.25), "M6.5 20a5.5 5.5 0 0 1 11 0M2.5 18.5a3.5 3.5 0 0 1 3-3.5M21.5 18.5a3.5 3.5 0 0 0-3-3.5"), "команда")
add(g, "building", "M5 20.5V5a1.5 1.5 0 0 1 1.5-1.5h7A1.5 1.5 0 0 1 15 5v15.5M15 9.5h3a1.5 1.5 0 0 1 1.5 1.5v9.5M3 20.5h18M8.5 7.5h3M8.5 11h3M8.5 14.5h3", "организация")
add(g, "public-link", J(C(12, 12, 8.5), "M3.5 12h17M12 3.5c2.3 2.3 3.5 5.2 3.5 8.5s-1.2 6.2-3.5 8.5c-2.3-2.3-3.5-5.2-3.5-8.5s1.2-6.2 3.5-8.5z"), "публичная ссылка")
add(g, "role", J(C(9, 8, 3.5), "M2.5 19.5a6.5 6.5 0 0 1 10-5.5M17.5 12l3.5 1.3V16c0 2.2-1.5 3.8-3.5 4.5-2-.7-3.5-2.3-3.5-4.5v-2.7z"), "источник роли")
add(g, "key", J(C(8, 15.5, 4.5), "M11.2 12.3L20 3.5M16.5 7l2.5 2.5M14.5 9l2 2"), "ключ провайдера")

# 4.6 statuses — the shape carries the meaning
g = "Статусы"
add(g, "status-todo", C(12, 12, 8), "к выполнению")
add(g, "status-progress", C(12, 12, 8), "в работе", fill="M12 4a8 8 0 0 1 0 16z")
add(g, "status-done", "", "готово",
    fill=J(C(12, 12, 9), "M7.3 13.2l1.4-1.4 2.3 2.3 4.8-5.3 1.4 1.4-6.2 6.7z"))
add(g, "status-overdue", J(C(12, 12, 8.5), "M12 7.5V13M12 16.5h.01"), "просрочено")
add(g, "saved", J(CLOUD, "M9.5 13.8l2 2 3.5-3.6"), "сохранено")
add(g, "saving", J(CLOUD, "M9 14h.01M12 14h.01M15 14h.01"), "сохраняю")
add(g, "offline", J(CLOUD, "M3.5 3.5l17 17"), "нет сети")
add(g, "alert", "M10.3 4.5a2 2 0 0 1 3.4 0l7 12.2a2 2 0 0 1-1.7 3H5a2 2 0 0 1-1.7-3zM12 9.5v4M12 16.7h.01", "предупреждение")
add(g, "error", "M8.5 3.5h7l5 5v7l-5 5h-7l-5-5v-7zM9.5 9.5l5 5M14.5 9.5l-5 5", "ошибка: восьмиугольник с крестом")
add(g, "locked-by", J(R(3, 11.5, 10, 8.5, 2.5), "M5.5 11.5V9a2.5 2.5 0 0 1 5 0v2.5", C(18, 15.75, 3)), "заблокировал …: место под метку человека")

# 4.7 facilitation
g = "Фасилитация"
add(g, "timer", J(C(12, 13.5, 7.5), "M12 13.5V10M10 3.5h4M18.5 7L20 5.5"), "таймер")
add(g, "vote", J("M13 6.5H6A2.5 2.5 0 0 0 3.5 9v9A2.5 2.5 0 0 0 6 20.5h9a2.5 2.5 0 0 0 2.5-2.5v-5.5", C(17.5, 6.5, 3.5), "M15.9 6.5l1.1 1.1 2-2.2"), "голосование: объект с отметкой")
add(g, "play", "M8 5.5v13a1 1 0 0 0 1.5.9l10-6.5a1 1 0 0 0 0-1.8l-10-6.5A1 1 0 0 0 8 5.5z", "запустить")
add(g, "pause", "M9 5v14M15 5v14", "пауза")
add(g, "present", J(R(3, 4, 18, 12, 2.5), "M12 16v4M8 20.5h8M10.5 7.8v4.4l3.6-2.2z"), "презентация")
add(g, "follow", J("M2.5 11c1.7-3.4 4.5-5.5 7.5-5.5s5.8 2.1 7.5 5.5c-1.7 3.4-4.5 5.5-7.5 5.5S4.2 14.4 2.5 11z", C(10, 11, 2.25), "M15 19.5h6M18.5 17l2.5 2.5-2.5 2.5"), "следовать")
add(g, "bring-all", J("M3.5 3.5l5 5M8.5 4.5v4h-4M20.5 20.5l-5-5M15.5 19.5v-4h4", C(12, 12, 2)), "позвать всех к себе")
add(g, "reaction", J(C(12, 12, 8.5), "M8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01"), "реакции")

# 4.8 agents
g = "Агенты"
AGENT = J(R(4, 4, 16, 16, 3), "M5 11l6-6M5 17L17 5M7 19L19 7M13 19l6-6")
add(g, "agent", AGENT, "агент: квадрат со штриховкой")
add(g, "skill-brief", J(R(3.5, 4, 8, 16, 1.5), "M6 8.5h3M6 12h3M6 15.5h3", R(14, 4, 6.5, 6.5, 1.5), R(14, 13.5, 6.5, 6.5, 1.5)), "Brief to room: текст → блоки")
add(g, "skill-diagram", J(C(6, 6, 2.5), C(18, 6, 2.5), C(12, 18, 2.5), "M8.5 6h7M7.3 8.2l3.5 7.6M16.7 8.2l-3.5 7.6"), "Diagram")
add(g, "skill-cards", J(R(3.5, 9, 14, 10.5, 2), "M6.5 6h12a2 2 0 0 1 2 2v8.5M7 12.3v4M10 14.3h5"), "Cards from a selection")
add(g, "skill-tidy", I["tidy"]["d"], "Tidy up (тот же знак, что упорядочить)")
add(g, "path-preview", J("M3.5 6V3.5H6M9 3.5h2.5V6M11.5 9v2.5H9M6 11.5H3.5V9", "M7.5 14.5v1.5a2 2 0 0 0 2 2h1.5M10 16l1.5 2-1.5 2", R(13, 13, 7.5, 7.5, 1.5)), "превью → применить")
add(g, "path-direct", J(R(3.5, 3.5, 17, 17, 3), "M13 6.5L8.5 13h4L11 17.5l4.5-6.5h-4z"), "пишет сразу")
add(g, "path-batch", J(R(3.5, 13, 4.5, 6.5, 1.2), R(9.75, 9.5, 4.5, 10, 1.2), R(16, 6, 4.5, 13.5, 1.2)), "пакетом")
add(g, "queue", "M6.5 3.5h11M6.5 20.5h11M7.5 3.5c0 4 4.5 5.5 4.5 8.5s-4.5 4.5-4.5 8.5M16.5 3.5c0 4-4.5 5.5-4.5 8.5s4.5 4.5 4.5 8.5", "в очереди")
add(g, "budget", "M4.5 7c0-1.7 3.4-3 7.5-3s7.5 1.3 7.5 3-3.4 3-7.5 3-7.5-1.3-7.5-3zM4.5 7v5c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V7M4.5 12v5c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-5", "бюджет задачи")
add(g, "journal", "M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19M9 7.5h6M9 10.5h6", "журнал")

LEGACY = ["plus", "minus", "close", "check", "chevron-down", "chevron-right", "more", "search", "lock", "unlock", "link", "cursor",
          "sticky", "frame", "shape", "text", "connector", "comment", "user", "users", "agent", "alert", "info", "offline",
          "cloud-check", "trash", "copy", "undo", "redo", "card", "eye", "vote", "timer", "pause", "play", "share", "boards",
          "apps", "template", "panel", "pencil", "settings", "download", "upload", "help", "sparkle", "building",
          "zoom-fit", "sign-out"]
RENAMED = {"cloud-check": "saved", "sparkle": "agent", "zoom-fit": "fit"}

os.makedirs(f"{OUT}/icons", exist_ok=True)


def svg(d, fill, size, sw):
    body = ""
    if d:
        body += f'<path d="{d}" fill="none" stroke="currentColor" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"/>'
    if fill:
        body += f'<path d="{fill}" fill="currentColor" fill-rule="evenodd"/>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 24 24">{body}</svg>\n'


def svg16(d, fill):
    body = ""
    if d:
        body += f'<path d="{d}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
    if fill:
        body += f'<path d="{fill}" fill="currentColor" fill-rule="evenodd"/>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">{body}</svg>\n'


for name, x in I.items():
    open(f"{OUT}/icons/remo-icon-{name}.svg", "w").write(svg(x["d"], x["fill"], 24, 2))
    # 16 px: geometry redrawn on its own 16 grid (snap16.py), stroke 1.5
    x["d16"], x["fill16"] = to16(x["d"]), to16(x["fill"], filled=True)
    open(f"{OUT}/icons/remo-icon-{name}-16.svg", "w").write(svg16(x["d16"], x["fill16"]))

json.dump({k: {"d": v["d"], **({"fill": v["fill"]} if v["fill"] else {}),
               "d16": v["d16"], **({"fill16": v["fill16"]} if v["fill16"] else {}), "group": v["group"], "meaning": v["meaning"]}
           for k, v in I.items()}, open(f"{OUT}/icons/icons.json", "w"), ensure_ascii=False, indent=1)

rows = ["| Старое имя | Новое имя | Что изменилось |", "|---|---|---|"]
for old in LEGACY:
    new = RENAMED.get(old, old)
    rows.append(f"| `{old}` | `{new}` | {'переименовано' if old in RENAMED else 'перерисовано'} |")
open(f"{OUT}/icons/mapping.md", "w").write(
    "# Сопоставление с `packages/ui/src/icons.ts`\n\n" + "\n".join(rows) +
    f"\n\nНовых имён: {len([k for k in I if k not in LEGACY])}. Всего в наборе: {len(I)}.\n")
missing = [o for o in LEGACY if RENAMED.get(o, o) not in I]
print("icons:", len(I), "missing legacy:", missing)
