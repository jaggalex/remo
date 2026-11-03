/**
 * Anchoring the evidential log.
 *
 * A hash chain protects against edits inside the database only if its latest head is
 * also recorded somewhere the same administrator cannot rewrite. With `REMO_AI_ANCHOR_DIR`
 * every day appends a line to a file outside the database (put it on another disk or sync
 * it elsewhere); with `REMO_AI_ANCHOR_URL` it posts the head to an append-only service.
 */
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export async function writeAnchor({ orgId, seq, hash, env = process.env, now = new Date() }) {
  const line = JSON.stringify({ orgId, seq, hash, at: now.toISOString() });
  const dir = env.REMO_AI_ANCHOR_DIR;
  if (dir) {
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${orgId}.jsonl`);
    await appendFile(path, `${line}\n`, "utf8");
    return { destination: "file", ref: path };
  }
  const url = env.REMO_AI_ANCHOR_URL;
  if (url) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env.REMO_AI_ANCHOR_TOKEN
          ? { Authorization: `Bearer ${env.REMO_AI_ANCHOR_TOKEN}` }
          : {}),
      },
      body: line,
    });
    if (!response.ok) {
      throw new Error(`anchor endpoint answered ${response.status}`);
    }
    return {
      destination: "http",
      ref: response.headers.get("x-anchor-id") ?? null,
    };
  }
  return null;
}

/**
 * Anchor the latest head of every organisation that has runs.
 *
 * Called on start and daily. If the head is already anchored there is nothing to do;
 * repeating the same line would only make the log noisier.
 */
export async function anchorAiLogs({ store, env = process.env, log = console }) {
  if (!env.REMO_AI_ANCHOR_DIR && !env.REMO_AI_ANCHOR_URL) {
    return { skipped: true, anchored: 0 };
  }
  const orgs = await store.orgsWithAiRuns();
  let anchored = 0;
  for (const orgId of orgs) {
    const latest = await store.latestAiRun(orgId);
    if (!latest) continue;
    const previous = await store.latestAiAnchor(orgId);
    if (previous?.hash === latest.hash) continue;
    try {
      const destination = await writeAnchor({
        orgId,
        seq: Number(latest.seq),
        hash: latest.hash,
        env,
      });
      if (!destination) continue;
      await store.recordAiAnchor({
        orgId,
        seq: Number(latest.seq),
        hash: latest.hash,
        destination: destination.destination,
        ref: destination.ref,
      });
      anchored += 1;
    } catch (error) {
      log.error?.(`[ai] anchor failed for ${orgId}:`, error.message);
    }
  }
  return { skipped: false, anchored };
}
