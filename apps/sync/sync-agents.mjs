/**
 * The agent scheduler (spec/AI-agents-v1.md).
 *
 * One tick at a time. Tasks are processed sequentially by the runner, so a large diagram
 * cannot starve the canvas or the event loop. The same loop anchors the AI journal's hash
 * chain once a day. Both timers are unref'd: they must never keep the process alive.
 */
import { agentLimitsFromEnv } from "./agent-context.mjs";
import { findDraftFrame, ROOM_DRAFT_SKILL } from "./agent-room-draft.mjs";
import { agentTick } from "./agent-runner.mjs";
import { anchorAiLogs } from "./ai-anchor.mjs";
import { Y } from "./y.mjs";

/** Repair the crash window between the room flush and the task/history updates. */
export async function recoverRoomDrafts(store, log) {
  const tasks = (await store.roomDraftsToRecover?.()) ?? [];
  let recovered = 0;
  for (const task of tasks) {
    try {
      const repaired = await store.withTenant(task.org_id, async () => {
        let result = task.status === "applied" ? task.result : null;
        if (task.status === "running") {
          const doc = new Y.Doc();
          try {
            // Read persisted state, not a live room that may have pending updates.
            await store.loadRoomStateInTenant(task.board_id, doc);
            const frameId = findDraftFrame(doc, task.id);
            if (frameId) {
              const widgets = doc.getMap("widgets");
              result = {
                frameId,
                createdIds: [...widgets.values()]
                  .filter((widget) => widget?.agent?.taskId === task.id)
                  .map((widget) => widget.id),
                title: widgets.get(frameId).title,
                recovered: true,
                skill: ROOM_DRAFT_SKILL.slug,
                skillVersion: task.skill_version,
              };
            }
          } finally {
            doc.destroy();
          }
        }
        return store.finishRecoveredRoomDraft(task, result?.frameId ? result : null);
      });
      if (repaired) recovered += 1;
    } catch (error) {
      log.error("[agent] room draft recovery failed:", error.message);
    }
  }
  return recovered;
}

export function createAgentLoops({ store, ai, log = console }) {
  let ticking = false;
  let timer = null;
  let anchorTimer = null;
  let recovering = false;

  async function tick() {
    if (recovering || ticking || typeof store.dueAgentSchedules !== "function") return;
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
    // The single production worker has not claimed work yet. A running room draft
    // at this point belongs to the previous process (ADR-189).
    recovering = true;
    void Promise.allSettled([recoverRoomDrafts(store, log), store.recoverStaleAgentTasks?.(15)])
      .then(([drafts, stale]) => {
        for (const result of [drafts, stale]) {
          if (result.status === "rejected") {
            log.error("[agent] recovery failed:", result.reason.message);
          }
        }
        const count =
          (drafts.status === "fulfilled" ? drafts.value : 0) +
          (stale.status === "fulfilled" ? (stale.value?.length ?? 0) : 0);
        if (count) log.log(`[agent] recovered ${count} stale task(s)`);
      })
      .finally(() => {
        recovering = false;
      });
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
