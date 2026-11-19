# Строки интерфейса для эпиков E1–E6

RU — источник, EN — перевод. Ключи — предложение для `apps/web/src/i18n` (`*-core.ts` для
холста и шапки, `*-work.ts` для таблицы, если файл ближе по смыслу); при вёрстке имя ключа
можно уточнить, текст — согласовать с дизайном. Отметки: **new** — новый ключ, **change** —
новый текст у существующего, **remove** — ключ уходит вместе с поведением.

## E1 · Замок на холсте (ADR-193)

| Ключ | RU | EN | |
|---|---|---|---|
| `canvas.locked` | Заблокирован | Locked | new — имя значка для скринридера |
| `canvas.lockedBy` | Заблокировал(а) {name} | Locked by {name} | new — author lock (ADR-107) |

## E2 · Тема и язык (ADR-194)

| Ключ | RU | EN | |
|---|---|---|---|
| `theme.lightAction` | Тема: светлая. Переключить на тёмную | Theme: light. Switch to dark | change (RU сверить) |
| `theme.darkAction` | Тема: тёмная. Переключить на светлую | Theme: dark. Switch to light | change — раньше вело к «системной» |
| `theme.systemAction` | — | — | remove |
| `theme.system` | — | — | remove |
| `lang.switchToEn` | Язык: русский. Switch to English | Language: Russian. Switch to English | new — имя кнопки «RU» |
| `lang.switchToRu` | Language: English. Переключить на русский | Language: English. Switch to Russian | new — имя кнопки «EN» |

## E3 · Первый вход (ADR-197, ещё не написан)

| Ключ | RU | EN | |
|---|---|---|---|
| `home.empty.title` | Ваши комнаты | Your rooms | new |
| `home.empty.body` | Здесь появятся комнаты, в которых вы работаете. | Rooms you work in will appear here. | new |
| `home.newRoom` | Новая комната | New room | проверить существующий |
| `home.examples` | Посмотреть пример: | See an example: | new (до решения о демо — скрыто) |
| `home.howItWorks` | Как это работает → | How it works → | new |
| `newBoard.start` | Как начать | How to start | new |
| `newBoard.start.empty` | Пустая комната | Empty room | new |
| `newBoard.start.emptyHint` | Начните с заметки или фигуры | Start with a note or a shape | new |
| `newBoard.start.example` | С примером | From an example | new |
| `newBoard.start.exampleHint` | История, схема, план или канбан | Story, diagram, plan or kanban | new |
| `newBoard.create` | Создать комнату | Create room | change |
| `empty.title` | Начните с заметки или фигуры | Start with a note or a shape | change |
| `empty.body` | Их можно соединить линией. | You can connect them with a line. | change — без «меню Ещё» |
| `empty.note` | Заметка | Note | new |
| `empty.shape` | Фигура | Shape | new |
| `empty.text` | Текст | Text | new |
| `empty.example` | Или посмотрите пример → | Or see an example → | new |

## E4 · Продолжение «+» (ADR-195)

| Ключ | RU | EN | |
|---|---|---|---|
| `continue.right` | Продолжить справа | Continue to the right | new — имя «+» |
| `continue.below` | Продолжить снизу | Continue below | new |
| `continue.left` | Продолжить слева | Continue to the left | new |
| `continue.above` | Продолжить сверху | Continue above | new |
| `continue.create` | Создать заметку справа | Create a note on the right | new — подпись превью; {side} по стороне |
| `continue.createShape` | Создать фигуру справа | Create a shape on the right | new |
| `continue.connect` | Связать с существующим | Connect to the existing one | new |
| `continue.createNew` | Создать новый | Create new | new |
| `continue.alreadyLinked` | Уже связаны — второй связи не будет | Already connected — no second line | new |
| `continue.hint` | Enter — создать · Esc — отмена | Enter — create · Esc — cancel | new |
| `continue.lockedTarget` | Цель заблокирована — связь допустима и её не меняет. | The target is locked — a line is allowed and does not change it. | new |
| `continue.live` | Продолжить заметкой справа. Enter — создать | Continue with a note on the right. Enter to create | new — `aria-live` |

## E5 · «Собрать в раздел»

| Ключ | RU | EN | |
|---|---|---|---|
| `selection.gather` | Собрать в раздел | Gather into a section | new |
| `selection.gather.preview` | Раздел охватит {count}. Они останутся собой: текст, связи и комментарии не меняются. | The section will hold {count}. They stay themselves: text, lines and comments do not change. | new |
| `selection.gather.conflictMember` | «{name}» уже в разделе «{section}» | “{name}” is already in “{section}” | new |
| `selection.gather.conflictMemberBody` | Собрать его сюда — значит вынуть из «{section}». Остальные соберутся без изменений. | Gathering it here takes it out of “{section}”. The rest are gathered unchanged. | new |
| `selection.gather.without` | Собрать без него | Gather without it | new |
| `selection.gather.takeOut` | Вынуть и собрать | Take out and gather | new |
| `selection.gather.locked` | Заблокированный объект не перемещается. Снять замок может {name}. | A locked object does not move. {name} can unlock it. | new |
| `selection.gather.nested` | Раздел нельзя собрать в другой раздел. | A section cannot be gathered into another section. | new |

## E6 · Раздел → таблица (ADR-196)

| Ключ | RU | EN | |
|---|---|---|---|
| `section.title` | Раздел | Section | проверить существующий «Раздел» у фрейма |
| `section.view` | Вид | View | new |
| `section.view.free` | Свободно | Free | new |
| `section.view.table` | Таблица | Table | new |
| `section.view.hint` | Только для этого раздела. | For this section only. | new |
| `section.badge.table` | Таблица | Table | new — чип у названия раздела |
| `section.axes` | Оси | Axes | new |
| `section.axes.addColumn` | Колонка | Column | new — кнопка с «+» |
| `section.axes.addRow` | Строка | Row | new |
| `section.axes.insertColumnBetween` | Вставить колонку между «{a}» и «{b}» | Insert a column between “{a}” and “{b}” | new |
| `section.axes.insertRowBetween` | Вставить строку между «{a}» и «{b}» | Insert a row between “{a}” and “{b}” | new |
| `section.axis.placeholderColumn` | Колонка {n} | Column {n} | new |
| `section.axis.placeholderRow` | Строка {n} | Row {n} | new |
| `section.axis.untitled` | Без названия | Untitled | new — для скринридера |
| `section.axis.rename` | Переименовать | Rename | new |
| `section.axis.insertLeft` | Вставить колонку слева | Insert column left | new |
| `section.axis.insertRight` | Вставить колонку справа | Insert column right | new |
| `section.axis.insertAbove` | Вставить строку сверху | Insert row above | new |
| `section.axis.insertBelow` | Вставить строку снизу | Insert row below | new |
| `section.axis.moveLeft` | Переместить влево | Move left | new |
| `section.axis.moveRight` | Переместить вправо | Move right | new |
| `section.axis.moveUp` | Переместить вверх | Move up | new |
| `section.axis.moveDown` | Переместить вниз | Move down | new |
| `section.axis.rotate` | Повернуть заголовок | Rotate header | new |
| `section.axis.size` | Размер | Size | new |
| `section.axis.deleteColumn` | Удалить колонку… | Delete column… | new |
| `section.axis.deleteRow` | Удалить строку… | Delete row… | new |
| `section.axis.deleteTitle` | Удалить колонку «{name}»? | Delete column “{name}”? | new (строка — `deleteRowTitle`) |
| `section.axis.deleteBody` | В колонке {count}. Что с ними сделать? | The column holds {count}. What should happen to them? | new |
| `section.axis.moveToLeft` | Перенести в соседнюю колонку слева — «{name}» | Move to the column on the left — “{name}” | new |
| `section.axis.moveToRight` | Перенести в соседнюю колонку справа — «{name}» | Move to the column on the right — “{name}” | new |
| `section.axis.moveToAbove` | Перенести в строку выше — «{name}» | Move to the row above — “{name}” | new |
| `section.axis.moveToBelow` | Перенести в строку ниже — «{name}» | Move to the row below — “{name}” | new |
| `section.axis.deleteWithObjects` | Удалить колонку вместе с объектами ({count}) | Delete the column with its objects ({count}) | new |
| `section.axis.undoHint` | Один ⌘Z вернёт колонку и объекты. | One ⌘Z brings the column and objects back. | new |
| `section.size.mode` | Размер | Size | new |
| `section.size.auto` | Авто | Auto | new |
| `section.size.manual` | Вручную | Manual | new |
| `section.size.autoHint` | По крайним объектам с небольшим отступом; пустая колонка — под один объект. | Fits the outermost objects with a small margin; an empty column holds one object. | new |
| `section.size.narrow` | Узкая | Narrow | new (у строки — «Низкая / Low») |
| `section.size.medium` | Средняя | Medium | new |
| `section.size.wide` | Широкая | Wide | new (у строки — «Высокая / Tall») |
| `section.size.value` | Ширина {px} px | Width {px} px | new (строка — «Высота») |
| `section.size.dragHint` | Перетаскивание границы переключает на «Вручную» | Dragging the edge switches to Manual | new |
| `section.size.keys` | Alt+← / Alt+→ — ширина, Alt+↑ / Alt+↓ — высота. | Alt+← / Alt+→ — width, Alt+↑ / Alt+↓ — height. | new |
| `section.look` | Оформление таблицы | Table appearance | new — свёрнутая группа |
| `section.look.default` | по умолчанию | default | new |
| `section.look.table` | Фон таблицы | Table background | new |
| `section.look.headers` | Фон заголовков | Header background | new |
| `section.look.selected` | Выбранная колонка «{name}» | Selected column “{name}” | new (строка/ячейка — аналогично) |
| `section.look.reset` | Как было | As before | new |
| `section.look.hint` | Ячейка, строка или колонка — для того, что выделено. Текст подстраивается сам. | Cell, row or column — for what is selected. Text adjusts itself. | new |
| `section.cell.drop` | Отпустите — встанут в «{column} × {row}», расстановка сохранится | Release — they go to “{column} × {row}”, keeping their arrangement | new |
| `section.cell.refuseHeader` | Заголовок не принимает объекты | A header does not take objects | new |
| `section.cell.moveTo` | Переместить в ячейку… | Move to cell… | new |
| `section.seed.title` | Как разложить материал? | How should the material be laid out? | new |
| `section.seed.byPosition` | Разложить по текущему расположению | Lay out by current position | new |
| `section.seed.firstCell` | Оставить всё в первой ячейке | Keep everything in the first cell | new |
| `section.seed.hint` | Превью на холсте показывает результат. Объекты не копируются; один ⌘Z вернёт как было. | The preview on the canvas shows the result. Objects are not copied; one ⌘Z undoes it. | new |
| `section.table.remove` | Убрать таблицу | Remove table | new |
| `section.table.removeHint` | Вернёт свободный вид. Объекты останутся. | Returns the free layout. Objects stay. | new |
| `section.table.removeNone` | Таблицы ещё нет. | There is no table yet. | new |
| `section.table.removeTitle` | Убрать таблицу? | Remove the table? | new |
| `section.table.removeBody` | Раздел «{name}» вернётся в свободный вид. Объекты останутся: {objects}, {lines}. | Section “{name}” returns to the free layout. Objects stay: {objects}, {lines}. | new |
| `section.table.removeMemory` | Ячейки запомнятся: если снова включить таблицу, структура вернётся. | Cells are remembered: turn the table on again and the structure returns. | new |
| `section.delete` | Удалить раздел | Delete section | проверить существующий |
| `section.deleteHint` | Объекты останутся на холсте. | Objects stay on the canvas. | new |
| `section.moveHint` | Перетаскивание раздела переносит таблицу целиком — объекты остаются в своих ячейках | Dragging the section moves the whole table — objects stay in their cells | new |
| `presentation.table.order` | По строкам | By rows | new |
| `presentation.table.position` | {row} · {column} — {n} из {total} | {row} · {column} — {n} of {total} | new |
| `presentation.table.keys` | ← → по ячейкам · Esc — выйти | ← → between cells · Esc — exit | new |
| `table.live.enter` | Таблица «{name}»: {columns} колонки, {rows} строки | Table “{name}”: {columns} columns, {rows} rows | new — `aria-live` |
| `table.live.cell` | {row}, {column}: {count} | {row}, {column}: {count} | new |

Числа объектов и колонок — через существующий `count()` (склонения RU).
