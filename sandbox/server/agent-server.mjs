/*
 * 星尘琥珀 · 后台 Agent 服务
 * ------------------------------------------------------------
 * 用 Node 原生 http 实现,零第三方依赖。启动:
 *   node server/agent-server.mjs            # 默认 http://localhost:8907
 *   PORT=9000 node server/agent-server.mjs
 *
 * 前端接入(两种任一):
 *   1) 打开 stardust.html?agent=http://localhost:8907
 *   2) 页面里设置 window.STARDUST_AGENT = { endpoint: 'http://localhost:8907' }
 *
 * 接口:
 *   POST /api/act    { sessionId, snapshot, event:{type:'click'|'chat', target?, text?} }
 *                    → { ok, directives:[ {op:'say'|'log'|'side'|'present'|'trust'|'ending'|'hint', ...} ] }
 *   POST /api/reset  { sessionId } → { ok }
 *   GET  /api/health → { ok, sessions }
 *
 * Agent 是“世界导演”:根据实时点击/对话 + 快照做状态判定,
 * 输出台词、支线解锁/完成、引导与结局裁决。前端负责确定性模拟与渲染。
 *
 * 它还会把游戏页面一起托管:启动后直接打开
 *   http://localhost:8907/          ← 页面 + Agent 同源,自动连上
 */
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession, act, SIDE_META } from './agent-core.mjs';

const PORT = Number(process.env.PORT || 8907);
const sessions = new Map();

const GAME_FILE = fileURLToPath(new URL('../stardust.html', import.meta.url));
const GAME_CACHE = { html: null };

function getSession(id) {
  let s = sessions.get(id);
  if (!s) {
    s = createSession();
    s.id = id;
    sessions.set(id, s);
  }
  return s;
}

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'cache-control': 'no-store'
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1_000_000) req.destroy(); });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, GET, OPTIONS',
      'access-control-allow-headers': 'content-type'
    });
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return send(res, 200, { ok: true, sessions: sessions.size });
  }

  /* 托管游戏页面:GET / 或 /stardust.html */
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/stardust.html' || url.pathname === '/index.html')) {
    if (!existsSync(GAME_FILE)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('找不到 stardust.html');
    }
    try {
      if (!GAME_CACHE.html) GAME_CACHE.html = readFileSync(GAME_FILE);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(GAME_CACHE.html);
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('读取 stardust.html 失败');
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/side') {
    const id = url.searchParams.get('sessionId') || 'anon';
    const s = getSession(id);
    return send(res, 200, { ok: true, side: s.side, meta: SIDE_META });
  }

  if (req.method === 'POST' && url.pathname === '/api/reset') {
    const body = await readBody(req);
    const id = body.sessionId || 'anon';
    const s = createSession();
    s.id = id;
    sessions.set(id, s);
    return send(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/act') {
    const body = await readBody(req);
    const id = body.sessionId || 'anon';
    const s = getSession(id);
    const snapshot = body.snapshot || {};
    const event = body.event || { type: 'idle' };
    let result;
    try {
      result = act(s, snapshot, event);
    } catch (err) {
      return send(res, 500, { ok: false, error: String(err && err.message || err) });
    }
    return send(res, 200, { ok: true, side: s.side, directives: result.directives });
  }

  return send(res, 404, { ok: false, error: 'not found' });
});

/* ---------- 自检:跑一条主线 + 支线的脚本 ---------- */
async function selftest() {
  const { execSync } = await import('node:child_process');
  const s = createSession();
  const snap = (extra) => Object.assign({ stage: 0, pressure: 0, trust: 0, presented: [], clues: {}, lightOn: false, lightAngle: 1, lecternRead: false, cabinetOpen: false }, extra);
  const out = [];
  const run = (label, snapshot, event) => {
    const r = act(s, snapshot, event);
    out.push('· ' + label + ' → ' + r.directives.filter((d) => d.op === 'say' || d.op === 'side').map((d) => d.op === 'side' ? '[支线:' + d.id + '=' + d.status + ']' : '"' + d.text.slice(0, 22) + '…"').join(' '));
  };
  run('点击讲解台', snap(), { type: 'click', target: 'lectern' });
  run('点全息星图 x1', snap(), { type: 'click', target: 'holo' });
  run('点全息星图 x2', snap(), { type: 'click', target: 'holo' });
  run('问她:你还好吗', snap({ pressure: 1 }), { type: 'chat', text: '你还好吗?别太累了' });
  const withClues = snap({ stage: 2, pressure: 2, clues: { extraStar: true, glassReflection: true, keyLog: true, pinArt: true }, presented: ['glass', 'key'] });
  run('逼问(触发出示)', withClues, { type: 'chat', text: '别装了,说实话' });
  run('决策:申请特展', snap({ stage: 3, pressure: 3 }), { type: 'chat', text: '替她申请特展吧' });
  console.log(out.join('\n'));
  console.log('\n支线状态:', JSON.stringify(s.side));
  console.log('SELFTEST OK');
}

if (process.argv.includes('--selftest')) {
  selftest();
} else {
  server.listen(PORT, () => {
    console.log('星尘琥珀 Agent 已启动: http://localhost:' + PORT);
    console.log('健康检查: GET /api/health   行为: POST /api/act');
  });
}
