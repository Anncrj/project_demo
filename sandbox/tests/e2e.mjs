import { launch, sleep, FILE_URL } from './browser.mjs';

const results = [];
let failures = 0;

function check(name, ok, extra) {
  results.push({ name, ok: !!ok, extra });
  if (!ok) failures++;
  const tail = extra === undefined ? '' : '  [' + JSON.stringify(extra) + ']';
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + tail);
}

const browser = await launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

/* ---------- A. 启动封面 ---------- */
await page.goto(FILE_URL + '?debug=1', { waitUntil: 'load' });
await sleep(900);
check('封面可见', await page.evaluate(() => {
  const c = document.getElementById('cover');
  return !c.classList.contains('hidden') && c.getBoundingClientRect().height > 300;
}));
check('进入按钮自动聚焦', await page.evaluate(() => document.activeElement && document.activeElement.id === 'enter'));
check('证书初始 inert', await page.evaluate(() => document.getElementById('cert').inert === true));
check('日志 aria-live', await page.evaluate(() => {
  const log = document.getElementById('log');
  return log.getAttribute('role') === 'log' && log.getAttribute('aria-live') === 'polite';
}));
check('封面有星点装饰', await page.evaluate(() => document.querySelectorAll('#cover-stars .star').length > 40));
check('浮动任务看板存在', await page.evaluate(() =>
  document.querySelectorAll('#tb-steps .tb-step').length === 7
  && document.getElementById('taskboard').closest('.stage') !== null
));
check('无按钮选项', await page.evaluate(() => document.querySelectorAll('.opt').length === 0));
check('显式「旋转星图」按钮存在', await page.evaluate(() => {
  const b = document.getElementById('dome-rotate');
  return !!b && !b.classList.contains('hidden') && b.getBoundingClientRect().height > 0;
}));

await page.keyboard.press('Enter');
await sleep(1300);
check('回车后封面关闭', await page.evaluate(() => document.getElementById('cover').classList.contains('hidden')));
check('开场日志已生成', await page.evaluate(() => document.getElementById('log').children.length >= 1));
check('当前对话框有内容', await page.evaluate(() => document.getElementById('now-text').textContent.length > 0));

/* ---------- A2. 自然语言输入框 ---------- */
await page.type('#chat-input', '你好');
await page.click('#chat-send');
await sleep(700);
check('输入框发送用户消息', await page.evaluate(() =>
  Array.from(document.querySelectorAll('#log .entry.user')).some((e) => e.textContent.indexOf('你好') !== -1)
));
check('林晚自然语言回复', await page.evaluate(() =>
  document.getElementById('now-text').textContent.indexOf('你好') === -1
  && document.getElementById('now-text').textContent.length > 2
));
check('对话框(对话记录)高度充足', await page.evaluate(() => {
  const r = document.getElementById('log').getBoundingClientRect();
  return r.height >= 120;
}));

/* ---------- B. 穹顶星图(用显式「旋转星图」按钮) ---------- */
check('旋转按钮可点(不被遮挡)', await page.evaluate(() => {
  const b = document.getElementById('dome-rotate');
  const r = b.getBoundingClientRect();
  const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!(el && (el.id === 'dome-rotate' || el.closest('#dome-rotate')));
}));
await page.click('#dome-rotate');
await sleep(300);
await page.click('#dome-rotate');
await sleep(400);
check('穹顶旋转后线索点亮', await page.evaluate(() => window.__STARDUST__.state.clue_extraStar === true));
check('穹顶揭示异常星', await page.evaluate(() => document.getElementById('sky-dome').classList.contains('revealed')));
check('任务看板进度更新', await page.evaluate(() => document.getElementById('tb-count').textContent.indexOf('1 /') === 0));

/* ---------- C. 聚光灯 ---------- */
await page.click('#spotlight');
await sleep(500);
check('聚光灯亮起(正中)', await page.evaluate(() => window.__STARDUST__.ui.lightOn === true));
check('地面反光线索点亮', await page.evaluate(() =>
  window.__STARDUST__.state.clue_glassReflection === true
  && document.querySelector('.clue-chip[data-clue="glassReflection"]').classList.contains('got')
));
check('光锥/光斑显示', await page.evaluate(() => document.querySelector('.hall').classList.contains('beam')));

/* ---------- D. 星宿拼豆小游戏 ---------- */
await page.click('#perler');
await sleep(600);
check('点击拼豆画打开小游戏', await page.evaluate(() =>
  !document.getElementById('studio').classList.contains('hidden')
));
check('豆库 6 色', await page.evaluate(() => document.querySelectorAll('.swatch').length === 6));
check('线稿 13 格', await page.evaluate(() => document.querySelectorAll('.pb-cell[data-need]').length === 13));
await page.evaluate(() => window.__STARDUST__.studio.solve());
await sleep(700);
check('拼完后可收好', await page.evaluate(() => !document.getElementById('studio-done').disabled));
await page.click('#studio-done');
await sleep(500);
check('小游戏关闭', await page.evaluate(() => document.getElementById('studio').classList.contains('hidden')));

/* 拖拽拼豆画到展柜旁 */
const dragFrom = await page.evaluate(() => {
  const r = document.getElementById('perler').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
const caseBox = await page.evaluate(() => {
  const r = document.getElementById('case').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.mouse.move(dragFrom.x, dragFrom.y);
await page.mouse.down();
for (let i = 1; i <= 12; i++) {
  await page.mouse.move(dragFrom.x + (caseBox.x - dragFrom.x) * i / 12, dragFrom.y + (caseBox.y - dragFrom.y) * i / 12);
  await sleep(16);
}
await page.mouse.up();
await sleep(900);
check('拼豆画已放置', await page.evaluate(() => window.__STARDUST__.ui.drawingPlaced === true));
check('拼豆画对齐线索', await page.evaluate(() => window.__STARDUST__.state.clue_pinArt === true));
check('拼豆画 beads 点亮', await page.evaluate(() => document.querySelectorAll('#bead-grid .bead.lit').length > 0));

/* ---------- E. 钥匙柜 ---------- */
await page.click('#cabinet');
await sleep(1200);
check('钥匙柜打开', await page.evaluate(() => window.__STARDUST__.ui.cabinetOpen === true));
check('借用登记线索', await page.evaluate(() => window.__STARDUST__.state.clue_keyLog === true));
check('登记卡显示', await page.evaluate(() => document.querySelector('.cabinet').classList.contains('open')));

/* ---------- F. 自然语言质询与破防 ---------- */
await page.type('#chat-input', '穹顶上多了一颗星');
await page.click('#chat-send');
await sleep(700);
await page.type('#chat-input', '地面上有反光的星点');
await page.click('#chat-send');
await sleep(700);
await page.type('#chat-input', '周叔把钥匙借给了谁?');
await page.click('#chat-send');
await sleep(900);
check('压力值拉满', await page.evaluate(() => window.__STARDUST__.state.pressure === 3));
check('进入破防(阶段3)', await page.evaluate(() => window.__STARDUST__.state.stage === 3));
check('最后一步给出输入提示', await page.evaluate(() => document.getElementById('chat-input').placeholder.indexOf('上报') !== -1));
check('对话记录有质询内容', await page.evaluate(() => document.getElementById('log').children.length >= 8));

/* ---------- G. 结局抉择(自然语言) ---------- */
await page.type('#chat-input', '我想替她申请特展,别上报');
await page.click('#chat-send');
await sleep(3200);
check('温暖结局证书', await page.evaluate(() =>
  !document.getElementById('cert').classList.contains('hidden')
  && !document.getElementById('cert').classList.contains('cold')
));
check('结局 starFixed', await page.evaluate(() => window.__STARDUST__.state.starFixed === true));
check('证书标题', await page.evaluate(() => document.getElementById('cert-title').textContent.indexOf('特展') !== -1));

/* ---------- H. 重开 ---------- */
await page.click('#again');
await sleep(1500);
check('重开后封面/状态重置', await page.evaluate(() => {
  const s = window.__STARDUST__.state;
  return s.stage === 0 && s.pressure === 0 && s.ending === null && s.clue_extraStar === false;
}));

/* ---------- I. 状态跳转 ---------- */
await page.goto(FILE_URL + '?debug=1&stage=match&play=1', { waitUntil: 'load' });
await sleep(1800);
check('jump match: pinArt', await page.evaluate(() => window.__STARDUST__.state.clue_pinArt === true));
check('jump match: 珠子点亮', await page.evaluate(() => document.querySelectorAll('#bead-grid .bead.lit').length > 0));

await page.goto(FILE_URL + '?debug=1&stage=script&play=1', { waitUntil: 'load' });
await sleep(1800);
check('jump script: pressure 3', await page.evaluate(() => window.__STARDUST__.state.pressure === 3));

await page.goto(FILE_URL + '?debug=1&stage=ending&play=1', { waitUntil: 'load' });
await sleep(2600);
check('jump ending: 证书可见', await page.evaluate(() => !document.getElementById('cert').classList.contains('hidden')));

/* ---------- I2. 泛化自然语言(逼问)也能推进,避免卡死 ---------- */
await page.goto(FILE_URL + '?debug=1&stage=glass&play=1', { waitUntil: 'load' });
await sleep(1600);
const p0 = await page.evaluate(() => window.__STARDUST__.state.pressure);
await page.type('#chat-input', '给我答案');
await page.click('#chat-send');
await sleep(1000);
check('逼问式输入也能推进压力', await page.evaluate((before) => window.__STARDUST__.state.pressure > before, p0));

/* ---------- J. 减弱动效 ---------- */
const rBrowser = await launch();
const rPage = await rBrowser.newPage();
await rPage.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
await rPage.goto(FILE_URL + '?debug=1&play=1', { waitUntil: 'load' });
await sleep(1200);
check('减弱动效:动画暂停', await rPage.evaluate(() => {
  const d = document.querySelector('.dust');
  return d && getComputedStyle(d).animationName === 'none';
}));
await rBrowser.close();

/* ---------- K. 零控制台错误 ---------- */
check('无控制台错误', errors.length === 0, errors.slice(0, 5));

await browser.close();

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILED') + ' (' + results.length + ' checks)');
process.exit(failures === 0 ? 0 : 1);
