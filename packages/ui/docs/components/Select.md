# Select

Нативный select в оформлении поля — выбор одного значения (роль, модель, скилл).

## Когда
- Выбор одного из 2–12 значений. Native-first: клавиатура и скринридер работают из коробки.
- Больше 12 значений или нужен поиск — Popover со списком (вне v1).

## Состояния
default · hover · focus-visible · disabled · error · selected (value). active, loading, read-only — не применимы: `select` нативный; read-only не поддерживается — используйте `disabled` или статичный текст.

## Потребитель передаёт
- `label`, `options` (`string` или `{value,label,disabled}`), `value`/`onChange`, `size`, `error`.
