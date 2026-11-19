import { useState } from "react";

/**
 * The tidy command's state, kept out of `App` because that file is at the size
 * ceiling (apps/web/AGENTS.md). The dialog opens with a snapshot of the selection, so
 * changing the board selection underneath does not change what the task will tidy.
 */
export interface TidyCommand {
  open: boolean;
  ids: string[];
  start: (ids: readonly string[]) => void;
  close: () => void;
  /** Close tidy and open the agents dialog, where a missing agent is created. */
  openAgents: () => void;
}

export function useTidyCommand({ openAgents }: { openAgents: () => void }): TidyCommand {
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  return {
    open,
    ids,
    start: (next) => {
      setIds([...next]);
      setOpen(true);
    },
    close: () => setOpen(false),
    openAgents: () => {
      setOpen(false);
      openAgents();
    },
  };
}
