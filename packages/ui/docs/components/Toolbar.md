# Toolbar

Вертикальный тулбар инструментов создания шириной 48 px; выбранный инструмент — accent-soft.

## Правила
- Инструменты по группам через разделитель: выбор → создание → связи и комментарии.
- У каждого — Tooltip с названием и клавишей (`shortcut`). Выбранный — `aria-pressed`.
- Парит над холстом: `bg-raised` + `shadow-bar`.

## Состояния
default · hover · focus-visible · selected · disabled. loading, error, read-only — не применимы.

## Потребитель передаёт
- `tools`: `{id, icon, label, shortcut?, disabled?}` | `{separator:true}`; `value`/`onChange`.
