/**
 * The room agent API (ADR-189).
 *
 * Kept beside `api.ts` rather than inside it: the size ratchet is a design constraint,
 * and assignment/history is one reason to change.
 */
import type { AgentTask } from "./api";
import { call } from "./apiCall";

/** The agent assigned to a room (ADR-189). */
export interface RoomAgentAssignment {
  agentId: string;
  name: string;
  enabled: boolean;
}

export interface RoomAgentState {
  assigned: RoomAgentAssignment | null;
  canAssign: boolean;
  publicLink: boolean;
  orgEnabled: boolean;
  boardEnabled: boolean;
  owner: boolean;
  status: string | null;
  /** The deterministic demo model answers instead of a provider. */
  demo: boolean;
  agents: Array<{ id: string; name: string }>;
}

export interface AgentThreadSummary {
  id: string;
  board_id: string;
  agent_id: string;
  agent_name: string;
  created_by: string | null;
  title: string;
  created_at: string;
  updated_at: string;
  messages: number;
  last_status: string | null;
}

export interface AgentThreadMessage {
  id: string;
  thread_id: string;
  role: "user" | "agent" | "system";
  author_id: string | null;
  author_name: string;
  agent_name: string | null;
  text: string;
  status: "queued" | "running" | "ready" | "stopped" | "error" | null;
  task_id: string | null;
  frame_ids: string[];
  created_at: string;
}

export interface AgentThreadDetail {
  thread: AgentThreadSummary;
  messages: AgentThreadMessage[];
}

export interface RoomTaskBody {
  intent: string;
  kind?: "process" | "delivery-plan" | "problem-map";
  sourceIds?: string[];
  origin?: { x: number; y: number };
  lang?: "ru" | "en";
}



export const roomAgentApi = {
  /* --------------------------------------------------------- room agent -- */
  roomAgent: (boardId: string) =>
    call<RoomAgentState>(`/boards/${encodeURIComponent(boardId)}/agent`),
  assignRoomAgent: (boardId: string, agentId: string | null) =>
    call<{ assigned: RoomAgentAssignment | null }>(
      `/boards/${encodeURIComponent(boardId)}/agent`,
      { method: "PUT", body: { agentId } },
    ),
  roomAgentThreads: (boardId: string) =>
    call<{ threads: AgentThreadSummary[] }>(
      `/boards/${encodeURIComponent(boardId)}/agent-threads`,
    ),
  createRoomAgentThread: (boardId: string, body: RoomTaskBody) =>
    call<{ thread: AgentThreadSummary; task: AgentTask }>(
      `/boards/${encodeURIComponent(boardId)}/agent-threads`,
      { method: "POST", body },
    ),
  roomAgentThread: (threadId: string) =>
    call<AgentThreadDetail>(`/agent-threads/${encodeURIComponent(threadId)}`),
  deleteRoomAgentThread: (threadId: string) =>
    call<{ deleted: true }>(`/agent-threads/${encodeURIComponent(threadId)}`, {
      method: "DELETE",
    }),
  clearRoomAgentThreads: (boardId: string) =>
    call<{ deleted: number }>(`/boards/${encodeURIComponent(boardId)}/agent-threads`, {
      method: "DELETE",
    }),
  sendRoomAgentMessage: (threadId: string, body: RoomTaskBody) =>
    call<{ thread: AgentThreadSummary; task: AgentTask }>(
      `/agent-threads/${encodeURIComponent(threadId)}/messages`,
      { method: "POST", body },
    ),

};
