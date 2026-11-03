# IconButton

Кнопка-иконка для тулбаров и строк; `label` обязателен и уходит в aria-label.

## Когда
- Повторяющиеся действия в плотных местах: тулбар, floating bar, строка таблицы, шапка панели.
- В критичных действиях (удалить, отозвать) — Button с подписью, не IconButton.

## Состояния
default · hover · active · focus-visible · disabled · selected. loading, error, read-only — не применимы: для загрузки — `Button` с `loading`.

## Потребитель передаёт
- `icon`, `label` (обязателен; без него — предупреждение в консоли), `size`, `selected` для переключателей, `variant` (`ghost` по умолчанию, `secondary`).
- Подсказку с шорткатом — оберните в Tooltip.

## Нельзя
- IconButton без Tooltip там, где смысл иконки не очевиден.
