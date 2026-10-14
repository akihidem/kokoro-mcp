import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BIN, FIXTURE, makeSigned, tmp } from './helpers.js';

function rpcClient(child) {
  let buf = '';
  const pending = new Map();
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          p.resolve(msg);
        }
      } catch {
        /* stderr 以外のノイズは無視 */
      }
    }
  });
  let nextId = 1;
  return (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve });
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`timeout: ${method}`));
        }
      }, 8000);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
}

function startServer(t, args) {
  const child = spawn(process.execPath, [BIN, 'serve', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  return { child, rpc: rpcClient(child) };
}

test('MCP: initialize / tools / resources の全経路', async (t) => {
  const dir = tmp();
  const { file } = makeSigned(dir);
  const { child, rpc } = startServer(t, ['--file', file]);

  const init = await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '0.0.0' },
  });
  assert.equal(init.result.serverInfo.name, 'kokoro-mcp');
  assert.equal(init.result.protocolVersion, '2025-06-18');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const tools = await rpc('tools/list');
  assert.deepEqual(
    tools.result.tools.map((x) => x.name).sort(),
    ['check_kokoro_status', 'get_kokoro_context', 'get_safety_profile'],
  );

  const ctx = await rpc('tools/call', { name: 'get_kokoro_context', arguments: {} });
  assert.ok(!ctx.result.isError);
  assert.ok(ctx.result.content[0].text.includes('status=verified'));
  assert.ok(ctx.result.content[0].text.includes('## AI に伝える境界線'));

  const sp = await rpc('tools/call', { name: 'get_safety_profile', arguments: {} });
  assert.ok(sp.result.content[0].text.includes('境界線'));
  assert.ok(!sp.result.content[0].text.includes('## 強み・関心'));

  const st = await rpc('tools/call', { name: 'check_kokoro_status', arguments: {} });
  const status = JSON.parse(st.result.content[0].text);
  assert.equal(status.servable, true);
  assert.equal(status.verification.status, 'verified');

  const res = await rpc('resources/read', { uri: 'kokoro://context' });
  assert.equal(res.result.contents[0].text, FIXTURE);

  const ping = await rpc('ping');
  assert.deepEqual(ping.result, {});

  const bad = await rpc('nonexistent/method');
  assert.equal(bad.error.code, -32601);

  const badTool = await rpc('tools/call', { name: 'no_such_tool', arguments: {} });
  assert.equal(badTool.error.code, -32602);
});

test('MCP: 未署名ファイルは isError で拒否、status は常に応答', async (t) => {
  const dir = tmp();
  const file = join(dir, 'kokoro.md');
  writeFileSync(file, FIXTURE);
  const { rpc } = startServer(t, ['--file', file]);

  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });

  const ctx = await rpc('tools/call', { name: 'get_kokoro_context', arguments: {} });
  assert.equal(ctx.result.isError, true);
  assert.ok(ctx.result.content[0].text.includes('署名'));

  const st = await rpc('tools/call', { name: 'check_kokoro_status', arguments: {} });
  const status = JSON.parse(st.result.content[0].text);
  assert.equal(status.servable, false);
  assert.equal(status.verification.status, 'unsigned');

  const res = await rpc('resources/read', { uri: 'kokoro://context' });
  assert.equal(res.error.code, -32002);
});

test('MCP: 要求の直後に stdin が閉じても、レジストリ取得を待って応答してから終了する', async (t) => {
  const { createServer } = await import('node:http');
  // 応答を遅らせるレジストリ。修正前はこの待ちの間に process.exit して応答が失われた
  const srv = createServer((req, res) => {
    setTimeout(() => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ spec: 'akashi-registry/0.1', keys: {}, documents: {} }));
    }, 300);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  const dir = tmp();
  const { file } = makeSigned(dir);
  const url = `http://127.0.0.1:${srv.address().port}/registry.json`;
  const child = spawn(process.execPath, [BIN, 'serve', '--file', file, '--registry', url], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stdin.end(
    JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'check_kokoro_status', arguments: {} } }) + '\n',
  );
  const code = await new Promise((r) => child.on('exit', r));
  assert.equal(code, 0);
  const msg = JSON.parse(out.trim().split('\n').pop());
  assert.equal(msg.id, 7);
  assert.equal(JSON.parse(msg.result.content[0].text).verification.status, 'verified');
});

test('MCP: 解析できない行には Parse error（-32700）、配列には Invalid Request を返す', async (t) => {
  const dir = tmp();
  const { file } = makeSigned(dir);
  const child = spawn(process.execPath, [BIN, 'serve', '--file', file], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stdin.end('{not json\n[]\n');
  await new Promise((r) => child.on('exit', r));
  const msgs = out.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(
    msgs.map((m) => [m.id, m.error.code]),
    [
      [null, -32700],
      [null, -32600],
    ],
  );
});
