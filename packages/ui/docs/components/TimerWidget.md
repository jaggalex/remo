# TimerWidget

Таймер фасилитации: время табличными цифрами, полоса прогресса, пауза и «+1 мин»; состояния running, paused, done.

## Правила
- Парит по центру над холстом (`shadow-bar`), видят все участники. Время — `subtitle` 600 с `tabular-nums`, чтобы цифры не прыгали.
- Полоса — `accent`, на паузе — `state-warning` + слово «На паузе»; по окончании — `warning-soft` и текст «Время вышло» (не только цвет).
- Управляет только фасилитатор: у остальных `controls={false}`.

## Состояния
running · paused · done · controls. Остальные не применимы: действия — `IconButton`/`Button`.

## Потребитель передаёт
- `seconds`, `total`, `state`, `controls`, `onStart`, `onPause`, `onAdd`.
