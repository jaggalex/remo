/**
 * One JSON body reader for the HTTP routes.
 *
 * The export surface, voting and the command API all accept a small JSON object. Three
 * copies had already drifted in size limits; one function keeps the ceiling and the
 * error shape identical.
 */
export async function readJsonBody(request, limit = 128 * 1024) {
  const result = await readJsonBodyResult(request, limit);
  return result.ok ? result.value : null;
}

/**
 * The same reader for a route that must tell "too large" from "not JSON".
 *
 * A backup import has a ceiling of its own and answers `413` on one and `422` on the
 * other; a `null` cannot say which.
 */
export async function readJsonBodyResult(request, limit = 128 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) return { ok: false, error: "TOO_LARGE" };
    chunks.push(chunk);
  }
  if (!chunks.length) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { ok: false, error: "BAD_JSON" };
  }
}
