/**
 * RU strings — изображения на холсте (ADR-249, `spec/images.md` §9).
 *
 * Исходная формулировка: тексты §9 нормативны, EN повторяет ключи один к одному.
 */
export const ruImage = {
  "tool.image": "Изображение",
  "tool.imageHint": "можно перетащить файл или вставить Ctrl+V",

  "image.drop.title": "Отпустите, чтобы добавить",
  "image.drop.partial": "{supported} из {total} файлов можно добавить: {types} не поддерживается",

  "image.upload.progress": "Загрузка {name} — {percent}%",
  "image.upload.done": "{name} добавлено",
  "image.upload.cancel": "Отменить загрузку",
  "image.upload.retry": "Повторить",
  "image.upload.remove": "Убрать",

  "image.error.tooLarge": "Файл больше 20 МБ",
  "image.error.badType": "Этот формат не поддерживается. Подойдут PNG, JPEG, WebP, GIF, AVIF",
  "image.error.quota": "Закончилось место в хранилище",
  "image.error.roomImages": "В комнате уже {max} изображений",
  "image.error.busy": "Сервер занят, попробуйте через минуту",
  "image.error.offline": "Нет соединения",
  "image.error.unknown": "Не удалось загрузить изображение",

  "image.replace": "Заменить",
  "image.description": "Описание",
  "image.open": "Открыть",
  "image.downloadOriginal": "Скачать оригинал",
  "image.naturalSize": "Исходный размер",
  "image.noDescription": "Изображение без описания",

  "image.alt.title": "Описание",
  "image.alt.hint":
    "Опишите, что на картинке. Это увидят те, кто пользуется программой чтения с экрана, и поиск по комнате.",
  "image.alt.placeholder": "Например: схема воронки продаж",
  "image.alt.save": "Сохранить",
  "image.alt.count": "{count} / {max}",

  "image.lightbox.download": "Скачать",
  "image.lightbox.caption": "Описание: {text}",
  "image.lightbox.hint": "Колесо — масштаб, перетаскивание — сдвиг, двойной клик — вписать",
};
