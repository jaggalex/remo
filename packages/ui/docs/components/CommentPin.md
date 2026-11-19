# CommentPin

Пин комментария 24 px с хвостом: инициалы автора или число ответов; решённый — нейтральный с галочкой.

## Правила
- Цвет — presence-цвет автора; решённый — `bg-active` + иконка `check`.
- Тред открывается сбоку от содержимого (П5), не поверх объекта.
- Пока F10 не реализован, роль `commenter` = `viewer` (ADR-063): пины в каталоге — задел.

## Состояния
default · selected · resolved · hover · focus-visible. disabled, loading, error, read-only — не применимы.

## Потребитель передаёт
- `author`, `color`, `count`, `resolved`, `selected`.
