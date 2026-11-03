#!/usr/bin/env node
/**
 * A controllable proxy in front of the sync service, for the offline scenario (ADR-090).
 *
 * Chromium's offline emulation does not affect connections to localhost, so a local e2e
 * run cannot lose its WebSocket by `setOffline`. This proxy can be paused over HTTP: it
 * refuses new requests, destroys live sockets, and resumes on command — the same
 * observable condition as a tunnel going away. It exists only in the test harness and is
 * never part of the product.
 */
import { createServer, request as httpRequest } from "node:http";
import net from "node:net";

const PORT = Number(process.env.E2E_PROXY_PORT ?? 1237);
const TARGET = new URL(process.env.E2E_PROXY_TARGET ?? "http://localhost:1235");
const targetPort = Number(TARGET.port);
const targetHost = TARGET.hostname;

let paused = false;
const live = new Set();

function control(request, response) {
  if (request.url === "/__control/pause") paused = true;
  else if (request.url === "/__control/resume") paused = false;
  else {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "unknown control" }));
    return;
  }
  if (paused) {
    for (const socket of live) socket.destroy();
    live.clear();
  }
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ paused }));
  console.log(`[e2e-proxy] ${paused ? "paused" : "resumed"}`);
}

const server = createServer((request, response) => {
  if (request.url?.startsWith("/__control/")) return control(request, response);
  if (paused) {
    response.writeHead(503, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "OFFLINE_FOR_TEST" }));
    return;
  }
  const upstream = httpRequest(
    {
      host: targetHost,
      port: targetPort,
      method: request.method,
      path: request.url,
      headers: request.headers,
    },
    (answer) => {
      response.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(response);
    },
  );
  upstream.on("error", () => response.destroy());
  request.pipe(upstream);
});

server.on("upgrade", (request, socket, head) => {
  if (paused) {
    socket.destroy();
    return;
  }
  const upstream = net.connect(targetPort, targetHost, () => {
    const headers = Object.entries(request.headers)
      .map(([name, value]) => `${name}: ${value}`)
      .join("\r\n");
    upstream.write(`${request.method} ${request.url} HTTP/1.1\r\n${headers}\r\n\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  live.add(socket);
  live.add(upstream);
  const clean = () => {
    live.delete(socket);
    live.delete(upstream);
  };
  socket.on("close", clean);
  socket.on("error", clean);
  upstream.on("close", clean);
  upstream.on("error", clean);
});

server.listen(PORT, () => {
  console.log(`[e2e-proxy] listening on :${PORT} → ${targetHost}:${targetPort}`);
});
