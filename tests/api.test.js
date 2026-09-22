import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../server/index.js';

let server;
const PORT = 3009;

test.before(() => {
  return new Promise((resolve) => {
    server = app.listen(PORT, () => {
      resolve();
    });
  });
});

test.after(() => {
  return new Promise((resolve) => {
    server.close(resolve);
  });
});

test('GET /health returns status ok', async () => {
  const res = await fetch(`http://localhost:${PORT}/health`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, 'ok');
});

test('GET /api/test-cases returns 5 curated scenarios', async () => {
  const res = await fetch(`http://localhost:${PORT}/api/test-cases`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.testCases.length, 5);
  assert.equal(data.testCases[0].id, 'wire-service');
});

test('POST /api/chat processes intake and returns guided response', async () => {
  const res = await fetch(`http://localhost:${PORT}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'api-test-session',
      message: 'Breaking: Cure for all diseases found in backyard weed!'
    })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.reply);
  assert.equal(data.stage, 'CLARIFICATION');
  assert.ok(data.reply.content.includes('question'));
});

test('POST /api/reset returns initial opening message', async () => {
  const res = await fetch(`http://localhost:${PORT}/api/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 'api-test-session' })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.match(data.reply.content, /Paste a headline, link, claim, or screenshot/i);
});
