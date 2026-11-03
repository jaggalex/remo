/**
 * The agent scheduler (spec/AI-agents-v1.md).
 *
 * One tick at a time. Tasks are processed sequentially by the runner, so a large diagram
 * cannot starve the canvas or the event loop. The same loop anchors the AI journal's hash
 * chain once a day. Both timers are unref'd: they must never keep the process alive.
 */
import { agentLimitsFromEnv } from "./agent-context.mjs";
import { agentTick } from "./agent-runner.mjs";
import { anchorAiLogs } from "./ai-anchor.mjs";

export function createAgentLoops({ store, ai, log = console }) {
  let ticking = false;
  let timer = null;
  let anchorTimer = null;

  async function tick() {
    if (ticking || typeof store.dueAgentSchedules !== "function") return;
    ticking = true;
    try {
      const result = await agentTick({
        store,
        ai,
        log,
        limits: agentLimitsFromEnv(),
      });
      for (const run of result.ran) {
        if (run.status === "failed") {
          log.error(`[agent] task failed: ${run.code}: ${run.message}`);
        }
      }
    } catch (error) {
      log.error("[agent] tick failed:", error.message);
    } finally {
      ticking = false;
    }
  }

  /** Called once on listen; a disk store has no schedules, so there is nothing to start. */
  function start() {
    if (typeof store.dueAgentSchedules !== "function") return;
    log.log(
      `[agent] ${ai.configured ? `model ${ai.model} via ${ai.baseUrl}` : "no model configured; queued tasks stay waiting until REMO_AI_API_KEY and REMO_AI_MODEL are set"}`,
    );
    void store
      .recoverStaleAgentTasks?.(15)
      .then((rows) => {
        if (rows?.length) log.log(`[agent] recovered ${rows.length} stale task(s)`);
      })
      .catch((error) => log.error("[agent] recovery failed:", error.message));
    timer = setInterval(() => void tick(), 3000);
    timer.unref?.();

    const anchor = async () => {
      try {
        const result = await anchorAiLogs({ store, log });
        if (!result.skipped && result.anchored) {
          log.log(`[ai] anchored ${result.anchored} log head(s)`);
        }
      } catch (error) {
        log.error("[ai] anchor tick failed:", error.message);
      }
    };
    void anchor();
    anchorTimer = setInterval(() => void anchor(), 24 * 60 * 60 * 1000);
    anchorTimer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    if (anchorTimer) clearInterval(anchorTimer);
  }

  return { tick, start, stop };
}
