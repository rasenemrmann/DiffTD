import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHelperClient, HelperError, watchHelper } from '../../viewer/src/helper-client.js';
import { setLanguage } from '../../viewer/src/i18n.js';

setLanguage('en');

function startStub(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const out = handler(req, Buffer.concat(chunks));
        res.writeHead(out.status ?? 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out.body ?? {}));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

const file = (name, text = 'abc') => new File([text], name);

test('info returns the helper facts; a toeexpand problem becomes a readable error', async () => {
  const ok = await startStub(() => ({ body: { folder: null, problem: null, uploadLimitBytes: 5 } }));
  assert.equal((await createHelperClient({ baseUrl: ok.base }).info()).uploadLimitBytes, 5);
  ok.server.close();
  const bad = await startStub(() => ({ body: { problem: 'x' } }));
  await assert.rejects(createHelperClient({ baseUrl: bad.base }).info(), (e) => e.kind === 'no-toeexpand' && /file reader/.test(e.message));
  bad.server.close();
});

test('lookup: hit returns the networks, miss returns null', async () => {
  const stub = await startStub((req) => (req.url.includes('hit') ? { body: { roots: { project1: {} } } } : { status: 404, body: { error: 'not converted yet' } }));
  const client = createHelperClient({ baseUrl: stub.base });
  assert.deepEqual(await client.lookup('hit'), { project1: {} });
  assert.equal(await client.lookup('miss'), null);
  stub.server.close();
});

test('convert sends the bytes with the safety header and the name', async () => {
  let seen;
  const stub = await startStub((req, body) => { seen = { url: req.url, header: req.headers['x-difftd'], type: req.headers['content-type'], body: body.toString() }; return { body: { roots: { a: 1 } } }; });
  const roots = await createHelperClient({ baseUrl: stub.base }).convert(file('My Proj.toe', 'bytes'), 'f'.repeat(64));
  assert.deepEqual(roots, { a: 1 });
  assert.equal(seen.header, '1');
  assert.equal(seen.type, 'application/octet-stream');
  assert.equal(seen.body, 'bytes');
  assert.match(seen.url, /name=My%20Proj\.toe/);
  stub.server.close();
});

for (const [status, kind, pattern] of [
  [413, 'too-large', /larger than 200 MB/],
  [415, 'not-project', /not a \.toe or \.tox/],
  [422, 'unreadable', /could not be read: Error in file/],
  [403, 'forbidden', /refused/],
  [500, 'generic', /Something went wrong/],
]) {
  test(`HTTP ${status} becomes a readable ${kind} error naming the file`, async () => {
    const stub = await startStub(() => ({ status, body: { error: status === 422 ? 'bad.toe: Error in file' : 'boom' } }));
    await assert.rejects(createHelperClient({ baseUrl: stub.base }).convert(file('bad.toe'), '0'.repeat(64)), (e) => {
      assert.ok(e instanceof HelperError);
      assert.equal(e.kind, kind);
      assert.match(e.message, pattern);
      if (status !== 403 && status !== 500) assert.match(e.message, /bad\.toe/);
      return true;
    });
    stub.server.close();
  });
}

test('an unreachable helper gives the unreachable error', async () => {
  const client = createHelperClient({ baseUrl: 'http://127.0.0.1:1' });
  await assert.rejects(client.info(), (e) => e.kind === 'unreachable');
  assert.equal(await client.isUp(), false);
});

test('isUp is true for any answer from the helper, even an error status', async () => {
  const stub = await startStub(() => ({ status: 500, body: {} }));
  assert.equal(await createHelperClient({ baseUrl: stub.base }).isUp(), true);
  stub.server.close();
});

test('watchHelper reports changes only, with backoff while down, and can be stopped', async () => {
  const states = [false, false, true, true, false];
  const delays = [];
  const calls = [];
  const client = { isUp: async () => states[calls.push(1) - 1] ?? false };
  const pending = [];
  const stop = watchHelper(client, (up) => calls.push(up ? 'UP' : 'DOWN'), {
    minMs: 10, maxMs: 80,
    setTimer: (fn, ms) => { delays.push(ms); pending.push(fn); return pending.length; },
    clearTimer: () => {},
  });
  for (let i = 0; i < 4; i += 1) { await new Promise((r) => setImmediate(r)); pending.shift()?.(); }
  await new Promise((r) => setImmediate(r));
  stop();
  const changes = calls.filter((c) => typeof c === 'string');
  assert.deepEqual(changes, ['DOWN', 'UP', 'DOWN']);
  assert.ok(delays[0] <= delays[1] || delays[1] === 10, 'delay grows while down');
  assert.ok(delays.every((d) => d <= 80));
});
