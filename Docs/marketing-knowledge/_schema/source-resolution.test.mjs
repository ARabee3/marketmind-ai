import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test, { after, before } from "node:test";
import { resolveSource } from "./source-resolution.mjs";

const requestCounts = new Map();
const server = createServer((request, response) => {
  const key = `${request.method} ${request.url}`;
  const count = (requestCounts.get(key) ?? 0) + 1;
  requestCounts.set(key, count);

  if (request.url === "/transient") {
    response.statusCode = count < 3 ? 503 : 204;
    response.end();
    return;
  }
  if (request.url === "/head-rejected") {
    response.statusCode = request.method === "HEAD" ? 405 : 200;
    response.end(request.method === "HEAD" ? undefined : "ok");
    return;
  }
  response.statusCode = 404;
  response.end();
});

let baseUrl;
const fastRetry = {
  attempts: 3,
  retryDelayMs: 1,
  headTimeoutMs: 1000,
  getTimeoutMs: 1000,
};

before(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  server.close();
  await once(server, "close");
});

test("retries transient source failures before accepting success", async () => {
  const result = await resolveSource(`${baseUrl}/transient`, fastRetry);

  assert.deepEqual(result, { ok: true, status: 204 });
  assert.equal(requestCounts.get("HEAD /transient"), 3);
});

test("falls back to GET when a source rejects HEAD", async () => {
  const result = await resolveSource(`${baseUrl}/head-rejected`, fastRetry);

  assert.deepEqual(result, { ok: true, status: 200 });
  assert.equal(requestCounts.get("HEAD /head-rejected"), 1);
  assert.equal(requestCounts.get("GET /head-rejected"), 1);
});

test("rejects a permanently unavailable source", async () => {
  const result = await resolveSource(`${baseUrl}/permanent`, fastRetry);

  assert.deepEqual(result, { ok: false, status: 404 });
  assert.equal(requestCounts.get("HEAD /permanent"), 1);
  assert.equal(requestCounts.get("GET /permanent"), 1);
});
