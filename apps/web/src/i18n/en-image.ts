/**
 * EN strings — images on the canvas (ADR-249, `spec/images.md` §9).
 *
 * Kept apart like the billing table: the whole feature is one subject, and the flat
 * namespace stays flat (ADR-093). Russian is the source wording (§9 is normative).
 */
export const enImage = {
  "tool.image": "Image",
  "tool.imageHint": "drag a file here or paste Ctrl+V",

  "image.drop.title": "Drop to add",
  "image.drop.partial": "{supported} of {total} files can be added: {types} not supported",

  "image.upload.progress": "Uploading {name} — {percent}%",
  "image.upload.done": "{name} added",
  "image.upload.cancel": "Cancel upload",
  "image.upload.retry": "Retry",
  "image.upload.remove": "Remove",

  "image.error.tooLarge": "The file is larger than 20 MB",
  "image.error.badType": "This format is not supported. PNG, JPEG, WebP, GIF and AVIF work.",
  "image.error.quota": "Storage is full",
  "image.error.roomImages": "The room already has {max} images",
  "image.error.busy": "The server is busy, try again in a minute",
  "image.error.offline": "No connection",
  "image.error.unknown": "The image could not be uploaded",

  "image.replace": "Replace",
  "image.description": "Description",
  "image.open": "Open",
  "image.downloadOriginal": "Download original",
  "image.naturalSize": "Original size",
  "image.noDescription": "Image without a description",

  "image.alt.title": "Description",
  "image.alt.hint":
    "Describe what the picture shows. Screen reader users and room search will see it.",
  "image.alt.placeholder": "For example: the sales funnel",
  "image.alt.save": "Save",
  "image.alt.count": "{count} / {max}",

  "image.lightbox.download": "Download",
  "image.lightbox.caption": "Description: {text}",
  "image.lightbox.hint": "Scroll to zoom, drag to move, double click to fit",
};
