import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createSession, act } from '../server/agent-core.mjs';

let failures = 0;
function check(name, ok, extra) {
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra === undefined ? '' : '  [' + JSON.stringify(extra) + ']'));
}

function snap(extra) {
  return Object.assign({
    stage: 0, pressure: 0, trust: 0, presented: [], clues: {},
    lightOn: false, lightAngle: 1, lecternRead: false, cabinetOpen: false
  }, extra || {});
}

/* ---------- A. 引擎单元测试:状态机 + 支线 ---------- */
{
  const s = createSession();
  let r = act(s, snap(), { type: 'click', target: 'lectern' });
  check('点击讲解台解锁/完成「誊写稿」', s.side.scribble === 'done');
  check('讲解台回应含旁白或台词', r.directives.some((d) => d.op === 'say'));

  r = act(s, snap(), { type: 'click', target: 'holo' });
  check('第一次点星图不解锁支线', s.side.starmap !== 'done');
  r = act(s, snap(), { type: 'click', target: 'holo' });
  check('第二次点星图完成「星图往事」', s.side.starmap === 'done');

  r = act(s, snap({ pressure: 1 }), { type: 'chat', text: '你还好吗?别太累了' });
  check('关心语句完成「一句关心」', s.side.kindness === 'done');
  check('关心返还 trust 指令', r.directives.some((d) => d.op === 'trust'));

  const withClues = snap({ stage: 2, pressure: 2, clues: { extraStar: true, glassReflection: true, keyLog: true, pinArt: true }, presented: ['glass', 'key'] });
  r = act(createSession(), withClues, { type: 'chat', text: '别装了,说实话' });
  check('逼问式输入触发出示证物', r.directives.some((d) => d.op === 'present'));

  r = act(createSession(), snap({ stage: 3, pressure: 3 }), { type: 'chat', text: '替她申请特展吧' });
  check('决策语句返回 ending 指令', r.directives.some((d) => d.op === 'ending' && d.which === 'gallery'));
}

/* ---------- B. HTTP 服务集成测试 ---------- */
const PORT = 8910;
const serverPath = fileURLToPath(new URL('../server/agent-server.mjs', import.meta.url));
const child = spawn(process.execPath, [serverPath], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });

async function waitHealth() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://localhost:' + PORT + '/api/health');
      if (r.ok) return true;
    } catch (e) {}
    await new Promise((res) => setTimeout(res, 100));
  }
  return false;
}

const up = await waitHealth();
check('Agent 服务启动并通过健康检查', up);

if (up) {
  const base = 'http://localhost:' + PORT;
  const sid = 'test-' + Date.now();
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

  const a1 = await post('/api/act', { sessionId: sid, snapshot: snap(), event: { type: 'click', target: 'lectern' } });
  check('HTTP: 点击讲解台返回 ok 且支线完成', a1.ok === true && a1.side.scribble === 'done');

  const a2 = await post('/api/act', { sessionId: sid, snapshot: snap(), event: { type: 'click', target: 'holo' } });
  await post('/api/act', { sessionId: sid, snapshot: snap(), event: { type: 'click', target: 'holo' } });
  check('HTTP: 连点星图完成星图往事', (await post('/api/act', { sessionId: sid, snapshot: snap(), event: { type: 'click', target: 'holo' } })).side.starmap === 'done');

  const a3 = await post('/api/act', { sessionId: sid, snapshot: snap({ pressure: 1 }), event: { type: 'chat', text: '你还好吗' } });
  check('HTTP: 关心语句完成一句关心', a3.side.kindness === 'done');

  const rs = await post('/api/reset', { sessionId: sid });
  check('HTTP: reset 返回 ok', rs.ok === true);

  const after = await fetch(base + '/api/side?sessionId=' + sid).then((r) => r.json());
  check('HTTP: reset 后支线归零', after.side.scribble === 'locked' && after.side.kindness === 'locked');
}

child.kill();
console.log('\n' + (failures === 0 ? 'AGENT ALL PASS' : failures + ' FAILED'));
process.exit(failures === 0 ? 0 : 1);
