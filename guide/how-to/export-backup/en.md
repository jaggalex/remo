## When you need it

You need to show the result outside the product, keep a state before a big rebuild, or move the room elsewhere.

## Before you start

- For an image or a PDF — the export permission (`board.export`). Every role has it, including **Viewer**.
- For a backup — the `board.backup` permission. An editor and above have it.
- For an import — the `board.manage` permission. The owner and co-owner have it.
- A public link grants neither.

## Steps: an image or a PDF

1. Open the room menu (the room’s name) and choose **Экспорт…** (export).
2. In the **Что экспортировать** (what to export) block choose **Выделение** (selection), **Фрейм** (frame) or **Вся комната** (whole room). The selection and frame options are available only with a matching selection: select the objects or the frame first.
3. In the **Формат** (format) block choose **PNG** or **PDF**.
4. If needed, enable **Include comments**: a list of open threads and numbered pins appears below the room.
5. Wait for it to finish and save the file.

Result: the image contains exactly the chosen scope.

## Steps: a backup

1. Press **Экспорт**.
2. Choose **Бэкап комнаты** (room backup).
3. Save the JSON file. Cyrillic letters from the room title are preserved in the filename.

Result: the file contains a manifest with a checksum, every room object, tags, presentation order and the discussion. A backup always covers the whole room, whatever is selected.

:::danger
Import replaces the whole room and cannot be undone. Take a backup of the current state first.
:::

## Steps: restore

1. In the same dialog find **Восстановление из бэкапа remo** (restore from a remo backup).
2. Press **Выбрать файл бэкапа** (choose a backup file) and pick the file.
3. Read what the dialog shows: the object count and the replacement warning.
4. Press **Заменить комнату** (replace the room).

Result: the room contains the objects from the file; the previous content is replaced, including comments. Current threads disappear, threads from the file become the room threads.

## Check

- Open the image and confirm it contains exactly the chosen scope.
- Check that the backup opens as JSON and contains `manifest`.
- After the import, check the number of objects and connectors.

## What to keep in mind

- Import is irreversible: old objects are not restored automatically. Take a backup of the current state before importing.
- A backup contains room text, so store it like a working document.
- Export does not change the room and does not block editing.

## Common mistakes

| Symptom | Cause |
|---|---|
| No backup option | the role lacks `board.backup` |
| "Nothing to export in this scope" | the scope is **Выделение** or **Фрейм** and nothing is selected |
| Import refused | the file is damaged or the checksum does not match |

## Where to go next

[Error codes](/guide/reference/errors) — what a refusal means and what to do about it.
