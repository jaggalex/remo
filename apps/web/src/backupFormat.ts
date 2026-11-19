import type { Board, KanbanState, Tag, TextDeltaOp, Widget } from "@remo/model";

export function backupFilename(disposition: string): string {
  const encoded = /(?:^|;)\s*filename\*=UTF-8'[^']*'([^;\s]+)/i.exec(disposition)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // A malformed extended filename can still have a usable ASCII fallback.
    }
  }
  return /(?:^|;)\s*filename="([^"]+)"/i.exec(disposition)?.[1] ?? "board.remo-backup.json";
}

/**
 * Reading a remo board backup in the browser (ADR-071).
 *
 * The format is deliberately plain JSON: `manifest` describes the file and carries a
 * checksum over everything else. Import accepts only this format — a foreign JSON file
 * is not "almost a board", it is a different thing, and guessing would put objects with
 * unknown semantics into a shared document.
 */
export interface BoardBackup {
  manifest: {
    format: string;
    version: number;
    boardId: string;
    title: string;
    exportedAt: string;
    checksum: string;
    counts: { widgets: number; connectors: number; assets: number };
    files: string[];
  };
  format: string;
  version: number;
  board: { id: string; title: string };
  widgets: Record<string, Widget>;
  texts: Record<string, string>;
  textDeltas?: Record<string, TextDeltaOp[]>;
  kanbans: Record<string, KanbanState>;
  meta: Record<string, string>;
  /** Version 2 added group names (ADR-101) and tags (ADR-102). */
  groupNames?: Record<string, string>;
  tags?: Record<string, Tag>;
  presentation?: string[];
  /** Version 2 exports comments; import restores them in a later step. */
  comments?: unknown[];
  assets: unknown[];
}

export class BackupError extends Error {
  constructor(readonly code: "NOT_A_BACKUP" | "VERSION" | "CHECKSUM" | "SHAPE") {
    super(code);
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonical(record[key])]),
    );
  }
  return value;
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
  0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
  0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
  0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
  0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

const rotr = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));

/**
 * SHA-256 in plain TypeScript.
 *
 * `crypto.subtle` only exists in a secure context, and a teammate opens the product at
 * `http://192.168.x.x:5173` — exactly where the browser withholds it. A checksum that
 * silently stops working on the LAN would make restore unusable there, so the few lines
 * are carried here. The algorithm is public and the value is an integrity check, not a
 * secret.
 */
export function sha256Hex(bytes: Uint8Array): string {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
    0x5be0cd19,
  ]);
  const length = bytes.length;
  const paddedLength = (((length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  // The bit length is a 64-bit big-endian integer; a backup never reaches 512 MiB, but
  // the high word is written anyway so the padding stays correct by construction.
  view.setUint32(paddedLength - 8, Math.floor(length / 0x20000000), false);
  view.setUint32(paddedLength - 4, (length << 3) >>> 0, false);

  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }

    let a = h[0]!;
    let b = h[1]!;
    let c = h[2]!;
    let d = h[3]!;
    let e = h[4]!;
    let f = h[5]!;
    let g = h[6]!;
    let hh = h[7]!;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + K[i]! + w[i]!) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }

  return [...h].map((word) => word.toString(16).padStart(8, "0")).join("");
}

function checksumOf(content: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(content)));
  return `sha256:${sha256Hex(bytes)}`;
}

/**
 * Check the file before touching the document.
 *
 * The checksum is the only thing that separates "a backup someone edited" from "a
 * backup remo wrote"; without it an import is a silent overwrite with unknown data.
 */
export async function verifyBoardBackup(bundle: unknown): Promise<BoardBackup> {
  if (!bundle || typeof bundle !== "object") throw new BackupError("NOT_A_BACKUP");
  const candidate = bundle as Partial<BoardBackup>;
  if (candidate.manifest?.format !== "remo.board.backup" || candidate.format !== "remo.board") {
    throw new BackupError("NOT_A_BACKUP");
  }
  const version = candidate.manifest.version;
  if ((version !== 1 && version !== 2) || candidate.version !== version) {
    throw new BackupError("VERSION");
  }
  const { manifest, ...content } = candidate as BoardBackup;
  const expected = checksumOf(content);
  if (expected !== manifest.checksum) throw new BackupError("CHECKSUM");
  if (
    !candidate.widgets ||
    typeof candidate.widgets !== "object" ||
    !candidate.kanbans ||
    typeof candidate.kanbans !== "object"
  ) {
    throw new BackupError("SHAPE");
  }
  return candidate as BoardBackup;
}

/** Turn a verified bundle into the model `loadBoard` expects. */
export function backupToBoard(bundle: BoardBackup): {
  board: Board;
  kanbanStates: Record<string, KanbanState>;
  textDeltas: Record<string, TextDeltaOp[]>;
  groupNames: Record<string, string>;
  tags: Record<string, Tag>;
  presentation: string[];
  comments: unknown[];
} {
  const widgets = Object.values(bundle.widgets);
  for (const widget of widgets) {
    if (!widget || typeof widget.id !== "string" || typeof widget.type !== "string") {
      throw new BackupError("SHAPE");
    }
  }
  return {
    board: {
      id: bundle.board?.id ?? bundle.manifest.boardId,
      title: bundle.board?.title ?? bundle.manifest.title ?? "",
      widgets,
      groupNames: bundle.groupNames ?? {},
      tags: bundle.tags ?? {},
      presentation: bundle.presentation ?? [],
    },
    kanbanStates: bundle.kanbans ?? {},
    textDeltas: bundle.textDeltas ?? {},
    groupNames: bundle.groupNames ?? {},
    tags: bundle.tags ?? {},
    presentation: bundle.presentation ?? [],
    comments: bundle.comments ?? [],
  };
}
