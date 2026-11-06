import http from 'node:http';
import { createObserverServer } from './server.mjs';
import { toLangfuseBatch, createLangfuseExporter } from './langfuse.mjs';

let passed = 0;
let failed = 0;
function check(name, ok, extra) {
  if (ok) { passed++; console.log('PASS  ' + name); }
  else {
    failed++;
    console.log('FAIL  ' + name + (extra === undefined ? '' : '  [' + JSON.stringify(extra) + ']'));
  }
}

const inst = createObserverServer({ port: 0, dataFile: null });
await inst.listen(0);
const port = inst.server.address().port;
const base = 'http://127.0.0.1:' + port;

async function post(list) {
  const res = await fetch(base + '/api/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(list)
  });
  return res.status;
}

/* ---- SSE 先连上,再发事件 ---- */
const sseFrames = [];
const sseReq = http.get(base + '/api/stream', (res) => {
  res.setEncoding('utf8');
  res.on('data', (chunk) => {
    sseFrames.push(chunk);
  });
});
await new Promise((r) => setTimeout(r, 150));

/* ---- 基本写入与脱敏 ---- */
const status = await post([
  { type: 'trace.start', traceId: 't1', ts: 1000, name: '修复登记卡', meta: { actor: 'seed-agent' }, data: { task: '修复' } },
  { type: 'context.read', traceId: 't1', ts: 1010, name: 'read file', data: { file: 'stardust.html', range: 'L515-650', chars: 4830, content: 'x'.repeat(3000), reason: '检查层级' } },
  { type: 'tool.start', traceId: 't1', ts: 1020, spanId: 's1', name: 'edit', data: { tool: 'edit_file' } },
  { type: 'tool.end', traceId: 't1', ts: 1040, spanId: 's1', parentId: 's1', name: 'edit', data: { ok: true } },
  { type: 'test.result', traceId: 't1', ts: 1050, data: { command: 'npm test', passed: 38, total: 38 } },
  { type: 'trace.end', traceId: 't1', ts: 1060, data: { status: 'success' } }
]);
check('POST /api/events 返回 204', status === 204, status);
await new Promise((r) => setTimeout(r, 120));

const eventsRes = await fetch(base + '/api/events?limit=100');
const events = await eventsRes.json();
check('事件查询条数正确', events.length === 6, events.length);

const ctx = events.find((e) => e.type === 'context.read');
check('上下文默认脱敏(无原文)', typeof ctx.data.content === 'object' && typeof ctx.data.content !== 'string');
check('保留 chars / sha256 / preview', ctx.data.content.chars === 3000 && typeof ctx.data.content.sha256 === 'string' && typeof ctx.data.content.preview === 'string' && ctx.data.content.preview.length <= 120);
check('普通字段不被脱敏', ctx.data.file === 'stardust.html' && ctx.data.range === 'L515-650');

const traces = await (await fetch(base + '/api/traces')).json();
check('trace 聚合:1 个任务', traces.length === 1 && traces[0].id === 't1');
check('trace 聚合:工具/测试/状态', traces[0].tools === 1 && traces[0].tests.passed === 38 && traces[0].status === 'success');
check('trace 聚合:上下文文件', traces[0].context.files.length === 1 && traces[0].context.files[0].file === 'stardust.html');

const detail = await (await fetch(base + '/api/traces/t1')).json();
check('trace 详情包含事件列表', Array.isArray(detail.events) && detail.events.length === 6 && detail.summary.id === 't1');

/* ---- SSE ---- */
await post([{ type: 'decision', traceId: 't1', ts: 2000, name: '根因', data: { summary: 'x' } }]);
await new Promise((r) => setTimeout(r, 250));
const stream = sseFrames.join('');
check('SSE 推送 append 事件', stream.indexOf('event: append') !== -1 && stream.indexOf('"decision"') !== -1);
sseReq.destroy();

/* ---- 仪表盘 ---- */
const home = await (await fetch(base + '/')).text();
check('仪表面板可访问', home.indexOf('CONTEXT OBSERVATORY') !== -1);

const health = await (await fetch(base + '/api/health')).json();
check('health: langfuse 未配置时关闭', health.ok === true && health.langfuse === false);

/* ---- Langfuse 映射(纯函数) ---- */
const batch = toLangfuseBatch([
  { type: 'trace.start', traceId: 'tx', ts: 1, name: 'demo', meta: {} },
  { type: 'generation.start', traceId: 'tx', ts: 2, spanId: 'g1', name: 'gen', data: { model: 'seed-1.6-pro' } },
  { type: 'generation.end', traceId: 'tx', ts: 9, spanId: 'g1', parentId: 'g1', name: 'gen', data: { usage: { input: 10, output: 5, total: 15 } } },
  { type: 'tool.start', traceId: 'tx', ts: 10, spanId: 's2', name: 'run npm test', data: { tool: 'run_command' } },
  { type: 'tool.end', traceId: 'tx', ts: 12, spanId: 's2', parentId: 's2', name: 'run npm test', data: { ok: true } },
  { type: 'score', traceId: 'tx', ts: 13, name: 'quality', data: { value: 1 } }
]);
const kinds = batch.map((b) => b.type);
check('Langfuse: trace-create', kinds.includes('trace-create'));
const gen = batch.find((b) => b.type === 'generation-create');
check('Langfuse: generation-create 携带 model/usage', !!gen && gen.body.model === 'seed-1.6-pro' && gen.body.usage.total === 15);
const span = batch.find((b) => b.type === 'span-create' && b.body.name === 'run npm test');
check('Langfuse: tool 起止合成 span', !!span && span.body.endTime !== span.body.startTime);
check('Langfuse: score-create', kinds.includes('score-create'));

check('Langfuse 导出器未配置时禁用', createLangfuseExporter({}).enabled === false);

/* ---- SDK 接入 ---- */
const { createTracer } = await import('./sdk.mjs');
const tracer = createTracer({ url: base, actor: 'sdk-test', tags: ['test'] });
const sdkTask = tracer.task('SDK 任务', { task: 'sdk smoke' });
sdkTask.readContext({ file: 'a.js', range: 'L1-10', content: 'x'.repeat(200), reason: 'r' });
await sdkTask.generation({ input: 'prompt', temperature: 0 }, async () => ({ output: 'ok', usage: { input: 3, output: 2, total: 5 } }));
await sdkTask.tool('run_command', { target: 'npm test' }, async () => ({ ok: true, summary: 'ok' }));
sdkTask.test({ command: 'npm test', passed: 1, total: 1 });
sdkTask.score('quality', 1);
await sdkTask.end('success');
await new Promise((r) => setTimeout(r, 250));

const sdkEvents = await (await fetch(base + '/api/events?limit=100&traceId=' + sdkTask.traceId)).json();
const sdkTypes = sdkEvents.map((e) => e.type);
check('SDK:完整事件链', sdkTypes.length === 9
  && sdkTypes.includes('trace.start') && sdkTypes.includes('context.read')
  && sdkTypes.includes('generation.end') && sdkTypes.includes('test.result') && sdkTypes.includes('trace.end'), sdkTypes.length);

const sdkSummary = (await (await fetch(base + '/api/traces')).json()).find((t) => t.id === sdkTask.traceId);
check('SDK:聚合与 usage', !!sdkSummary && sdkSummary.status === 'success'
  && sdkSummary.tools === 1 && sdkSummary.tokens.input === 3 && sdkSummary.tokens.output === 2, sdkSummary && sdkSummary.status);

let sdkThrew = false;
try {
  await sdkTask.tool('bad_tool', {}, async () => { throw new Error('boom'); });
} catch (err) { sdkThrew = true; }
await new Promise((r) => setTimeout(r, 200));
const failedTool = (await (await fetch(base + '/api/events?limit=100&traceId=' + sdkTask.traceId)).json())
  .filter((e) => e.type === 'tool.end' && e.data && e.data.ok === false);
check('SDK:工具异常上报失败态且异常透传', sdkThrew && failedTool.length === 1);

await inst.close();
console.log('\n' + passed + '/' + (passed + failed) + ' 断言通过');
if (failed) process.exit(1);
