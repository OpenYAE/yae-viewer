// Headless smoke: builds nothing, serves dist/, opens the viewer in Chromium
// (SwiftShader WebGL), feeds it a folder of game files through the test hook
// and screenshots the result. Needs `npm i -D playwright && npx playwright
// install chromium` once; the folder comes from YAE_ASSETS (a gameres-like
// tree, or any folder with the files to open).
//
//   npm run build && YAE_ASSETS=/path/to/gameres node scripts/smoke.mjs [file-in-folder …]
//
// Without file arguments the first .ds2md and the first .ds2 of the folder are
// opened in turn. Screenshots land in smoke-out/.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const { chromium } = await import('playwright');
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const ASSETS = process.env.YAE_ASSETS;
if (!ASSETS) {
  console.error('YAE_ASSETS is not set');
  process.exit(2);
}
const OUT = path.join(ROOT, 'smoke-out');
mkdirSync(OUT, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', '4190', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));
let failed = false;
try {
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/MultiplyBlending/.test(m.text())) errors.push(m.text());
  });
  await page.goto('http://localhost:4190/yae-viewer/');
  await page.waitForSelector('.empty-state', { timeout: 20000 });
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.setAttribute('webkitdirectory', '');
    input.id = 'smoke-dir';
    document.body.appendChild(input);
  });
  await page.setInputFiles('#smoke-dir', ASSETS);
  const count = await page.evaluate(async () => {
    const files = document.getElementById('smoke-dir').files;
    await window.__yaeOpenFiles(files, false);
    return files.length;
  });
  console.log(`scanned ${count} files`);
  const wanted = process.argv.slice(2);
  const targets = wanted.length > 0 ? wanted : await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[aria-label="Files"] [role="treeitem"]')].map((el) => el.dataset.nodeId).filter(Boolean);
    return [rows.find((p) => p.endsWith('.ds2md')), rows.find((p) => p.endsWith('.ds2'))].filter(Boolean);
  });
  for (const target of targets) {
    const name = path.basename(target);
    await page.getByLabel('Search files').fill(name);
    await page.getByRole('treeitem', { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click();
    await page.waitForFunction(() => !document.querySelector('.loading-overlay'), null, { timeout: 300000 });
    await page.waitForTimeout(1500);
    const shot = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: shot });
    const info = await page.evaluate(() => document.querySelector('.info-card')?.innerText.replace(/\n/g, ' '));
    console.log(`${name}: ${info}\n  → ${shot}`);
  }
  if (errors.length > 0) {
    failed = true;
    console.error('errors:\n' + errors.join('\n'));
  }
  await browser.close();
} finally {
  server.kill();
}
process.exit(failed ? 1 : 0);
