# Toolbar

Вертикальный тулбар инструментов создания шириной 48 px; выбранный инструмент — серая заливка `bg-hover` и `aria-pressed`, не цвет.

## Правила
- Инструменты по группам через разделитель: выбор → создание → связи и комментарии.
- У каждого — Tooltip с названием и клавишей (`shortcut`). Выбранный — `aria-pressed`.
- Лежит над холстом пилюлей: `bg-raised`, волосяная линия 1 px `border-subtle`, `radius-pill`; тени нет (`shadow-bar` = `none`, правило E2, ADR-181).

## Состояния
default · hover · focus-visible · selected · disabled. loading, error, read-only — не применимы.

## Потребитель передаёт
- `tools`: `{id, icon, label, shortcut?, disabled?}` | `{separator:true}`; `value`/`onChange`.
