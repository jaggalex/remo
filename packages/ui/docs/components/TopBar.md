# TopBar

Шапка доски 52 px: название, read-only, статус синхронизации, presence и единственная primary «Поделиться».

## Анатомия
Слева: знак, название доски (ellipsis + title), ReadOnlyBadge, SyncStatus. Центр — `children` (режимы, таймер). Справа: AvatarStack и Share.

## Правила
- «Поделиться» — единственная primary на экране доски. При read-only кнопка остаётся (посмотреть, кто имеет доступ), но не меняет права.
- Статус синхронизации — только здесь (паттерн 4).

## Состояния
default · read-only · saved/pending/offline · presence. Остальные не применимы: действия — `Button`.

## Потребитель передаёт
- `boardName`, `sync`, `readOnly`, `presence` (имена), `onShare` (`null` скрывает), `children`.
