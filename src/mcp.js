import { createInterface } from 'node:readline';
import { assess, banner, statusJson } from './assess.js';
import { safetyProfile } from './kokoro.js';

const PROTOCOL_FALLBACK = '2025-06-18';

const TOOLS = [
  {
    name: 'get_kokoro_context',
    description:
      'kokoro.md（ユーザの AI 取扱説明書）の全文を、署名・同意・失効を検証した上で返す。セッション開始時に一度呼び、以降の応答スタイル・配慮事項として常に適用すること。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_safety_profile',
    description:
      "kokoro.md の安全サブセット（「AI に伝える境界線」と「配慮してほしいこと DO/DON'T」）のみを返す。全文が不要な場面の最小開示用。",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'check_kokoro_status',
    description: 'kokoro.md の検証状態（署名・レジストリ失効・流通可否）を JSON で返す。本文は含まない。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

const RESOURCES = [
  { uri: 'kokoro://context', name: 'kokoro.md', description: '検証済み kokoro.md 全文', mimeType: 'text/markdown' },
  { uri: 'kokoro://safety', name: 'kokoro safety profile', description: '境界線・配慮のみの安全サブセット', mimeType: 'text/markdown' },
  { uri: 'kokoro://status', name: 'kokoro status', description: '検証状態 JSON（本文を含まない）', mimeType: 'application/json' },
];

class McpError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function startMcpServer(opts) {
  const serverInfo = { name: 'kokoro-mcp', version: opts.version };
  process.stderr.write(
    `kokoro-mcp serve: policy=${opts.policy ?? 'clinical'} file=${opts.file ?? '(auto)'} registry=${opts.registry ?? '(auto)'}\n`,
  );
  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.id === undefined || msg.id === null) return; // notification
    try {
      const result = await handle(msg, opts, serverInfo);
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n');
    } catch (e) {
      const code = e instanceof McpError ? e.code : -32603;
      process.stdout.write(
        JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code, message: e.message } }) + '\n',
      );
    }
  });
  rl.on('close', () => process.exit(0));
}

async function handle(msg, opts, serverInfo) {
  switch (msg.method) {
    case 'initialize':
      return {
        protocolVersion:
          typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : PROTOCOL_FALLBACK,
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo,
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: TOOLS };
    case 'resources/list':
      return { resources: RESOURCES };
    case 'prompts/list':
      return { prompts: [] };
    case 'tools/call':
      return callTool(msg.params?.name, opts);
    case 'resources/read':
      return readResource(msg.params?.uri, opts);
    default:
      throw new McpError(-32601, `unknown method: ${msg.method}`);
  }
}

async function callTool(name, opts) {
  const a = await assess(opts);
  const refuse = () => ({
    content: [{ type: 'text', text: `kokoro.md は配信できません:\n- ${a.refusals.join('\n- ')}` }],
    isError: true,
  });
  switch (name) {
    case 'get_kokoro_context': {
      if (!a.servable) return refuse();
      return { content: [{ type: 'text', text: `${banner(a, opts.version)}\n${a.doc.text}` }] };
    }
    case 'get_safety_profile': {
      if (!a.servable) return refuse();
      const sp = safetyProfile(a.doc);
      if (!sp) {
        return {
          content: [{ type: 'text', text: '境界線・配慮セクションが見つかりません（§4.1 #1 / #5）' }],
          isError: true,
        };
      }
      return { content: [{ type: 'text', text: `${banner(a, opts.version)}\n${sp}` }] };
    }
    case 'check_kokoro_status':
      return { content: [{ type: 'text', text: JSON.stringify(statusJson(a), null, 2) }] };
    default:
      throw new McpError(-32602, `unknown tool: ${name}`);
  }
}

async function readResource(uri, opts) {
  const a = await assess(opts);
  if (uri === 'kokoro://status') {
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(statusJson(a), null, 2) }] };
  }
  if (uri === 'kokoro://context' || uri === 'kokoro://safety') {
    if (!a.servable) throw new McpError(-32002, `kokoro.md は配信できません: ${a.refusals.join('; ')}`);
    const text = uri === 'kokoro://context' ? a.doc.text : safetyProfile(a.doc);
    if (!text) throw new McpError(-32002, '境界線・配慮セクションが見つかりません');
    return { contents: [{ uri, mimeType: 'text/markdown', text }] };
  }
  throw new McpError(-32002, `unknown resource: ${uri}`);
}
