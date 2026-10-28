import test from "node:test";
import assert from "node:assert/strict";
import { createPhifBridgeServer } from "../server.js";

test("health compatibility and rejected reads do not reach PHIF or expose sessions in diagnostics", async () => {
  let calls = 0; const logs = [], original = console.info;
  console.info = (...args) => logs.push(args);
  const server = createPhifBridgeServer({ secret: "private-key", fetchImpl: async () => { calls++; throw new Error("must not contact PHIF"); } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.service, "phif-local-bridge"); assert.equal(health.protocolVersion, 1);
    assert.equal(health.capabilities.manualReadFence, true);
    const rejected = await fetch(`${base}/api/bridge-sessions/private-session/orders`, { headers: { "X-PHIF-Bridge-Secret": "private-key", "X-Pharmacy-Id": "tiryaq" } });
    assert.equal(rejected.status, 404); await rejected.text();
    assert.equal(calls, 0);
    assert.ok(logs.some(args => args[0] === "[phif-manual-read]"));
    assert.doesNotMatch(JSON.stringify(logs), /private-key|private-session|cookie|token|password/);
  } finally { console.info = original; server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
