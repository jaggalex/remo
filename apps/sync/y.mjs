/**
 * Single Yjs instance for the server process.
 *
 * `y-websocket`'s server utilities are CommonJS and pull the CJS build of Yjs;
 * importing the ESM build elsewhere in the same process loads a second copy and
 * breaks their constructor checks (yjs#438). Everything server-side resolves Yjs
 * through this module so there is exactly one instance.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const Y = require("yjs");
export const encoding = require("lib0/encoding");
export const awarenessProtocol = require("y-protocols/awareness");
export const websocketUtils = require("y-websocket/bin/utils");
