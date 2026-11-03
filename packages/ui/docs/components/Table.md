# Table

Таблица данных: липкая шапка, без зебры, табличные цифры справа, действия строки в конце.

## Когда
- Каталог досок, люди организации, аудит, AI-журнал (JournalList построен на Table).

## Правила
- Данные отдельно от управления (П5): фильтры и массовые действия — над таблицей, не в ней.
- Числа — колонка `numeric` (выравнивание вправо, `tabular-nums`). Длинные имена — ellipsis + `title`.
- Hover строки — `bg-hover`, выбранная — `accent-soft`.

## Состояния
default · hover (строка) · active (строка) · selected (строка) · empty. focus-visible, disabled, loading, error, read-only — не применимы: фокус и действия принадлежат контролам в ячейках.

## Потребитель передаёт
- `columns`: `{key, label, width?, align?, numeric?, render?}`, `rows`, `rowActions(row)`, `caption`, `maxHeight`.
- List — облегчённый вариант для двухстрочных элементов: `items: {title, meta, leading, trailing}`.
