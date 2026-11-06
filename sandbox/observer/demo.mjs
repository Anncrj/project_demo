/**
 * 演示:用 sdk.mjs 模拟一次 Seed Agent 任务 + 一次游戏会话,推送到 observer。
 *   node demo.mjs                 # 约 30 秒
 *   node demo.mjs --speed=6       # 加速
 *   ARK_API_KEY=... node demo.mjs --live
 */

import { createTracer } from './sdk.mjs';

const BASE = process.env.OBSERVER_URL || 'http://localhost:4318';
const SPEED = Number((process.argv.find((a) => a.startsWith('--speed=')) || '').split('=')[1] || 1);
const LIVE = process.argv.includes('--live');
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(40, ms / SPEED)));

const agent = createTracer({ url: BASE, actor: 'seed-agent', model: 'seed-1.6-pro', tags: ['stardust', 'debug'], demo: !LIVE });

const FILE = 'sandbox/stardust.html';

async function liveGeneration() {
  const res = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.ARK_API_KEY },
    body: JSON.stringify({
      model: process.env.ARK_MODEL || 'doubao-seed-1-6',
      messages: [
        { role: 'system', content: '你是代码审查助手,用三点中文回答。' },
        { role: 'user', content: '登记卡被父级 preserve-3d+filter 裁剪,给出最小修复方案。' }
      ],
      temperature: 0.2
    })
  });
  const data = await res.json();
  const u = (data && data.usage) || {};
  console.log('[live] seed 返回:', ((data.choices && data.choices[0] && data.choices[0].message.content) || '').slice(0, 120));
  return { output: '见控制台', usage: { input: u.prompt_tokens, output: u.completion_tokens, total: u.total_tokens } };
}

async function agentRun() {
  const task = agent.task('修复登记卡显示不完整', {
    task: '修复钥匙柜登记卡被 3D/filter 父级裁剪的问题',
    priority: 'high'
  });
  await sleep(900);

  task.step('定位根因', {
    plan: ['定位登记卡 DOM 结构', '检查父级 transform/filter', '重构为独立定位', '回归测试']
  });
  await sleep(700);

  task.readContext({
    file: FILE,
    range: 'L515-650',
    content: '<cabinet> 抽屉 .drawer { transform-style: preserve-3d; filter: brightness() } …',
    reason: '检查登记卡与抽屉的层级关系'
  });
  await sleep(650);
  task.readContext({
    file: FILE,
    range: 'L1950-2060',
    content: '<div class="key-card"> 借 用 登 记 … footer …',
    reason: '确认卡片内容与尺寸约束'
  });
  await sleep(800);

  task.decision({ summary: '父级 preserve-3d + filter 拍平并裁剪子元素 → 登记卡移出抽屉,改为独立定位' });
  await sleep(900);

  await task.generation(
    { input: '修复方案:重构 key-card 结构与展开动画', temperature: 0.2, promptChars: 6180 },
    async () => {
      await sleep(1400);
      if (LIVE && process.env.ARK_API_KEY) {
        try { return await liveGeneration(); } catch (err) { console.warn('[live] 回退演示数据:', err.message); }
      }
      return {
        output: '1) key-card 移出 drawer;2) 独立 z-index + clip-path 展开;3) 尺寸 142×127、字段逐行浮现',
        usage: { input: 2410, output: 380, total: 2790 }
      };
    }
  );
  await sleep(800);

  await task.tool('edit_file', { target: FILE, input: { operations: 6 } }, async () => {
    await sleep(1200);
    return { ok: true, summary: '+86 −34 lines' };
  });
  await sleep(500);

  await task.tool('run_command', { target: 'npm test' }, async () => {
    await sleep(1800);
    return { ok: true, summary: '38/38 passed' };
  });
  task.test({ command: 'npm test', passed: 38, total: 38 });
  await sleep(600);

  task.score('implementation-quality', 1, '登记卡完整显示,无回归');
  await task.end('success', { durationMs: Math.round(9200 / SPEED) });
}

async function gameRun() {
  const tracer = createTracer({ url: BASE, actor: 'game', tags: ['stardust', 'playtest'], demo: true });
  const task = tracer.task('闭馆谜题 · 试玩会话', { task: '手动游玩:调灯 → 拖画 → 开柜 → 读稿 → 结局' });
  const steps = [
    ['glassReflection', 1, { lightAngle: 1, trust: 1 }],
    ['drawingMatch', 2, { drawingPlaced: true }],
    ['keyLog', 3, { cabinetOpen: true }],
    ['curatorScript', 3, { cabinetOpen: true }]
  ];
  for (const [clue, stage, ctx] of steps) {
    await sleep(900);
    task.step(clue, { clue, stage, context: ctx });
  }
  await sleep(900);
  task.step('结局达成', { stage: 4, trust: 3 });
  await task.end('success', { durationMs: Math.round(5400 / SPEED) });
}

(async function main() {
  console.log('→ ' + BASE + (LIVE ? ' (live mode)' : ' (demo mode)'));
  await agentRun();
  await sleep(1200);
  await gameRun();
  console.log('演示完成。打开 ' + BASE + ' 查看面板。');
})();
