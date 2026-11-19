# Frame

Фрейм: заголовок слева сверху, номер порядка для презентации, состояния selected, drop-target, hidden, clipped.

## Правила
- Заголовок над рамкой: `label` 600, `text-secondary`; номер порядка — бейдж слева.
- `drop-target` — пунктир акцента + `accent-soft`, пока в него перетаскивают объект.
- Удаление фрейма не удаляет содержимое (ADR-070) — ConfirmDialog говорит это прямо.

## Состояния
default · selected · drop-target · hidden · clipped. Остальные не применимы: фрейм — объект холста.

## Потребитель передаёт
- `title`, `order`, `state`, `width`, `height`, `children` (объекты внутри).
