import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { exclusiveManualRead } from "../phif/manualRead.js";
import { PhifClient } from "../phif/client.js";

function response() {
  const res = new EventEmitter();
  res.writableEnded = false;
  res.writeHead = status => { res.status = status; };
  res.end = body => { res.body = body; res.writableEnded = true; };
  return res;
}
test("a second stock/orders read for the same pharmacy never reaches PHIF, including different sessions", async () => {
  const operations = new Map(), res = response(), duplicate = response();
  let release;
  const first = exclusiveManualRead(res, "tiryaq", operations, async () => new Promise(resolve => { release = resolve; }));
  let called = false;
  await exclusiveManualRead(duplicate, "tiryaq", operations, async () => { called = true; });
  assert.equal(duplicate.status, 409); assert.equal(called, false);
  await exclusiveManualRead(response(), "other-pharmacy", operations, async () => "independent");
  release(); await first; assert.equal(operations.size, 0);
});
test("disconnect aborts a running read and releases its lock only after cancellation settles", async () => {
  const res = response(), operations = new Map();
  const read = exclusiveManualRead(res, "tiryaq", operations, signal => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
  }));
  res.emit("close");
  await assert.rejects(read, /cancelled/); assert.equal(operations.size, 0); assert.equal(res.listenerCount("close"), 0);
});
test("manual read deadline propagates through the client without changing login/session handling", async () => {
  const operations = new Map();
  await assert.rejects(exclusiveManualRead(response(), "tiryaq", operations, signal => {
    const client = new PhifClient({ signal, timeoutMs: 10000, fetchImpl: async (url, options) => new Promise((resolve, reject) => {
      assert.equal(new URL(url).pathname, "/get-pharmacy-stock");
      options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }) });
    return client.getJson("/get-pharmacy-stock");
  }, 15), error => error.code === "PHIF_UPSTREAM_TIMEOUT");
  assert.equal(operations.size, 0);
});
test("ordinary completion does not abort the session or retain a pending lock", async () => {
  const res = response(), operations = new Map(); let signal;
  await exclusiveManualRead(res, "tiryaq", operations, async value => { signal = value; res.end("ok"); });
  res.emit("close"); assert.equal(signal.aborted, false); assert.equal(operations.size, 0);
});
