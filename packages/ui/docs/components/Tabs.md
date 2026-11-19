# Tabs

Вкладки внутри диалога или панели со счётчиками; стрелки ←/→ переключают.

## Когда
- Разделы одного объекта: OrgDialog (Люди / Агенты / Аудит), инспектор (Свойства / История).
- Не больше 5 вкладок; подписи с 30 % запасом под EN.

## Состояния
default · hover · active · focus-visible · selected. disabled, loading, error, read-only — не применимы.

## Потребитель передаёт
- `tabs`: `{id, label, count?}`, `value`/`onChange` или `defaultValue`, `label`.
