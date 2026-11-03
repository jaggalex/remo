# Dialog

Модальный диалог sm 420 / md 560 / lg 720: шапка, скроллящееся тело, всегда видимый футер, focus trap.

## Правила
- Одна primary-кнопка (П2): Dialog считает primary/danger в `footer` и предупреждает в консоли.
- `Esc` и клик по затемнению закрывают (если `dismissable` не `false`); фокус уходит на первый элемент и возвращается на источник при закрытии.
- Высота ≤ `100vh − 40px`, тело скроллится, футер с действиями виден всегда.
- Заголовок — `title` (H2); группы внутри — H3 (`subtitle`). Не больше двух уровней.

## Состояния
default · alert (`alertdialog`) · dismissable. hover, active — не применимы к контейнеру; focus-visible — внутри (ловушка фокуса); disabled, loading, error, read-only, selected — не применимы.

## Потребитель передаёт
- `title`, `description`, `size`, `children`, `footer` (кнопки: secondary слева, primary справа), `onClose`, `dismissable`.
- `inline` — без затемнения и ловушки (каталог, эталоны).
