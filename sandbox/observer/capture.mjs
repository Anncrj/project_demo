import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const EDGE = process.env.CHROME_PATH || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].find((p) => existsSync(p));

const out = process.env.OBSERVER_SHOT || join(fileURLToPath(new URL('../docs/screens/', import.meta.url)), 'observer.png');
const url = (process.env.OBSERVER_URL || 'http://localhost:4318') + '/';

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1500,1000', '--disable-gpu'],
  defaultViewport: { width: 1500, height: 1000 }
});
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1800));
await page.screenshot({ path: out });
const info = await page.evaluate(() => ({
  traces: document.getElementById('traces').innerText.replace(/\n+/g, ' | ').slice(0, 500),
  events: document.getElementById('ev-count').textContent,
  conn: document.getElementById('conn-text').textContent
}));
console.log('captured ->', out);
console.log('panel:', JSON.stringify(info, null, 2));
await browser.close();
