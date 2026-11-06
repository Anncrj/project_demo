import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { launch, sleep, FILE_URL } from './browser.mjs';

const outDir = fileURLToPath(new URL('../docs/screens/', import.meta.url));
mkdirSync(outDir, { recursive: true });
const out = (name) => join(outDir, name + '.png');

const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1000 });

// 启动封面
await page.goto(FILE_URL, { waitUntil: 'load' });
await sleep(1400);
await page.screenshot({ path: out('cover') });

// 关键状态
const shots = [
  ['glass', 'glass', 1800],
  ['match', 'match', 2400],
  ['script', 'script', 2000],
  ['ending', 'ending', 4200],
];
for (const [name, stage, wait] of shots) {
  await page.goto(FILE_URL + '?stage=' + stage, { waitUntil: 'load' });
  await sleep(wait);
  await page.screenshot({ path: out(name) });
  console.log('captured', name);
}

// 星宿拼豆小游戏:半成品 + 完成态
await page.goto(FILE_URL + '?debug=1&stage=glass', { waitUntil: 'load' });
await sleep(1600);
await page.click('#perler');
await sleep(1000);
await page.screenshot({ path: out('studio') });
console.log('captured studio');
await page.evaluate(() => window.__STARDUST__.studio.solve());
await sleep(1600);
await page.screenshot({ path: out('studio-done') });
console.log('captured studio-done');

await browser.close();
console.log('done -> docs/screens/');
