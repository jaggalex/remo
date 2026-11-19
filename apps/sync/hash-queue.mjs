/**
 * A small queue around `scrypt`.
 *
 * Each hash takes 32 MiB and a thread-pool slot. Rate limits bound attempts per key and
 * per address, but a burst from many addresses can still queue an unbounded number of
 * hashes in memory. Run at most `concurrency` at once and refuse new work when the
 * waiting room is full, instead of accepting everything and hoping the pool drains.
 */
export function createHashQueue({ concurrency = 4, waiting = 64 } = {}) {
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
      else reject(Object.assign(new Error("HASH_BUSY"), { code: "HASH_BUSY" }));
    });
  }

  return { withSlot, stats: () => ({ active, waiting: queue.length }) };
}

const number = (raw, fallback) => {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const hashQueue = createHashQueue({
  concurrency: number(process.env.REMO_HASH_CONCURRENCY, 4),
  waiting: number(process.env.REMO_HASH_QUEUE, 64),
});
