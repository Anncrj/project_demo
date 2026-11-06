import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

export const FILE_URL = new URL('../stardust.html', import.meta.url).href;

export function findBrowser() {
  const candidates = [];
  if (process.env.CHROME_PATH) candidates.push(process.env.CHROME_PATH);
  if (process.platform === 'win32') {
    candidates.push(
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium'
    );
  }
  const hit = candidates.find((p) => existsSync(p));
  if (!hit) {
    throw new Error('未找到本机 Chrome/Edge,请设置 CHROME_PATH 环境变量指向浏览器可执行文件');
  }
  return hit;
}

export async function launch() {
  return puppeteer.launch({
    executablePath: findBrowser(),
    headless: 'new',
    args: ['--window-size=1500,1000', '--disable-gpu'],
    defaultViewport: { width: 1500, height: 1000 },
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function clickCenter(page, selector) {
  const box = await page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
  await page.mouse.click(box.x, box.y);
}
