# Checkbox

Checkbox, Radio и Switch: выбор, один из нескольких и мгновенное включение.

## Когда
- **Checkbox** — выбор, который применяется по кнопке («Удалить вместе с содержимым»). Есть `indeterminate` для «выбрать все».
- **Radio** — один из 2–5 взаимоисключающих вариантов, все видны сразу.
- **Switch** — настройка, которая применяется сразу («Ссылка для всех»). Никогда не в форме с кнопкой «Сохранить».

## Состояния
default · hover · focus-visible · disabled · selected (checked) · indeterminate. active, loading, error, read-only — не применимы.

## Потребитель передаёт
- `label`, `hint`, `checked`/`onChange`, `disabled`. Switch без видимой подписи — `aria-label`.
