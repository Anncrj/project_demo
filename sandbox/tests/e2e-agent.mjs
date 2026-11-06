import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from './browser.mjs';

const FILE_URL = new URL('../stardust.html', import.meta.url).href;
const PORT = 8911;
const serverPath = fileURLToPath(new URL('../server/agent-server.mjs', import.meta.url));
const child = spawn(process.execPath, [serverPath], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });

let failures = 0;
function check(name, ok, extra) {
  if (!ok) failures++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra === undefined ? '' : '  [' + JSON.stringify(extra) + ']'));
}

async function waitHealth() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch('http://localhost:' + PORT + '/api/health'); if (r.ok) return true; } catch (e) {}
    await new Promise((res) => setTimeout(res, 100));
  }
  return false;
}

const up = await waitHealth();
check('Agent 服务已启动', up);

const browser = await launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(FILE_URL + '?agent=http://localhost:' + PORT + '&play=1&debug=1', { waitUntil: 'load' });
await sleep(1500);

check('侧栏标记为 Agent 模式', await page.evaluate(() => document.getElementById('side-agent').textContent === 'Agent'));
check('初始三支线均未解锁', await page.evaluate(() => document.querySelectorAll('#side-list .side-item.locked').length === 3));

/* 点击讲解台 -> 后台 Agent 判定完成「誊写稿」 */
await page.click('#lectern');
await sleep(900);
check('Agent: 点击讲解台完成誊写稿', await page.evaluate(() =>
  Array.from(document.querySelectorAll('#side-list .side-item')).some((e) => e.textContent.indexOf('誊写稿') >= 0 && e.textContent.indexOf('已完成') >= 0)
));

/* 对星图点两次 -> 后台完成「星图往事」 */
await page.click('#holo');
await sleep(300);
await page.click('#holo');
await sleep(1100);
check('Agent: 连点星图完成星图往事', await page.evaluate(() =>
  Array.from(document.querySelectorAll('#side-list .side-item')).some((e) => e.textContent.indexOf('星图往事') >= 0 && e.textContent.indexOf('已完成') >= 0)
));

/* 自然语言关心 -> 后台完成「一句关心」 */
await page.type('#chat-input', '你还好吗?别太累了');
await page.click('#chat-send');
await sleep(1100);
check('Agent: 关心语句完成一句关心', await page.evaluate(() =>
  Array.from(document.querySelectorAll('#side-list .side-item')).some((e) => e.textContent.indexOf('一句关心') >= 0 && e.textContent.indexOf('已完成') >= 0)
));
check('Agent 回复进入对话记录', await page.evaluate(() =>
  document.getElementById('log').textContent.indexOf('谢谢您') >= 0
));

check('无控制台错误', errors.length === 0, errors.slice(0, 5));

await browser.close();
child.kill();
console.log('\n' + (failures === 0 ? 'AGENT-E2E ALL PASS' : failures + ' FAILED'));
process.exit(failures === 0 ? 0 : 1);
