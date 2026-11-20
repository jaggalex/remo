/**
 * The upload processing queue (ADR-249, `spec/images.md` §4.2).
 *
 * `sharp` decoding a 50-megapixel image is the largest transient allocation the service
 * makes. Rate limits bound uploads per person, but many people can still queue images at
 * once, so at most `REMO_FILES_CONCURRENCY` run and the waiting room is bounded. A full
 * queue answers `busy` (HTTP 503) immediately: holding the request in memory is worse than
 * asking the uploader to retry.
 *
 * The shape follows `hash-queue.mjs` on purpose; one queue pattern in the service.
 */
import { FilesError } from "./files-store.mjs";

export function createFilesQueue({ concurrency = 2, waiting = 16 } = {}) {
  let active = 0;
  const queue = [];

  function withSlot(task) {
    return new Promise((resolve, reject) => {
      const run = () => {
        active += 1;
        Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            const next = queue.shift();
            if (next) next();
          });
      };
      if (active < concurrency) run();
      else if (queue.length < waiting) queue.push(run);
      else reject(new FilesError("busy", "FILES_BUSY"));
    });
  }

  return {
    withSlot,
    stats: () => ({ active, waiting: queue.length }),
  };
}

const positive = (raw, fallback) => {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
};

export const filesQueue = createFilesQueue({
  concurrency: positive(process.env.REMO_FILES_CONCURRENCY, 2),
  waiting: positive(process.env.REMO_FILES_QUEUE, 16),
});
