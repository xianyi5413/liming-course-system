const assert = require("node:assert/strict");
const { test } = require("node:test");
const { CdpSession } = require("./helpers/chrome_cdp");

class TestSocket extends EventTarget {
  readyState = WebSocket.OPEN;
  sent = [];
  send(payload) { this.sent.push(JSON.parse(payload)); }
  close() { this.readyState = WebSocket.CLOSED; this.dispatchEvent(new Event("close")); }
}

test("CDP disconnect rejects every pending command instead of hanging browser teardown", async () => {
  const socket = new TestSocket(), session = new CdpSession(socket);
  const first = session.send("Runtime.evaluate"), second = session.send("Page.captureScreenshot");
  socket.close();
  await assert.rejects(first, /CDP_CONNECTION_CLOSED/);
  await assert.rejects(second, /CDP_CONNECTION_CLOSED/);
  await assert.rejects(session.send("Browser.close"), /CDP_CONNECTION_CLOSED/);
  assert.equal(session.pending.size, 0);
});

test("CDP normal responses settle and unanswered commands fail within their deadline", async () => {
  const socket = new TestSocket(), session = new CdpSession(socket);
  const response = session.send("Runtime.evaluate");
  session.onMessage({ data: JSON.stringify({ id: socket.sent[0].id, result: { value: 42 } }) });
  assert.deepEqual(await response, { value: 42 });
  await assert.rejects(session.send("Page.captureScreenshot", {}, 10), /CDP_COMMAND_TIMEOUT: Page.captureScreenshot/);
  assert.equal(session.pending.size, 0);
});

test("Browser.close can finish when Chrome disconnects before replying", async () => {
  const socket = new TestSocket(), session = new CdpSession(socket);
  socket.send = () => queueMicrotask(() => socket.close());
  await session.close();
  assert.equal(session.pending.size, 0);
});

test("CDP socket errors release pending commands", async () => {
  const socket = new TestSocket(), session = new CdpSession(socket);
  const response = session.send("Runtime.evaluate");
  socket.dispatchEvent(new Event("error"));
  await assert.rejects(response, /CDP_CONNECTION_CLOSED/);
  assert.equal(session.pending.size, 0);
});
