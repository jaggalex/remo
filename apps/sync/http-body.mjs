/**
 * One JSON body reader for the HTTP routes.
 *
 * The export surface, voting and the command API all accept a small JSON object. Three
 * copies had already drifted in size limits; one function keeps the ceiling and the
 * error shape identical.
 */
export async function readJsonBody(request, limit = 128 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) return null;
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}
