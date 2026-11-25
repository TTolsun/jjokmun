const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

function loadChromium() {
  try { return require('playwright-core').chromium; }
  catch (error) {
    throw new Error('테스트 폴더에서 npm install을 실행하세요.', {cause: error});
  }
}

const installed = path.resolve(__dirname, '../jjokmun');
const extension = fs.existsSync(path.join(installed, 'manifest.json')) ? installed : path.resolve(__dirname, '../extension');
async function selectFolder(page, name = 'test-vault', button = '#choose-first-folder') {
  await page.evaluate(name => {
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(name, {create:true});
  }, name);
  await page.locator(button).click();
  await page.locator('.workspace:visible, #lock-screen:visible').waitFor();
}

async function launch(profile, extensionPath = extension) {
  const chromium = loadChromium();
  const executablePath = process.env.MEMO_CHROME_PATH || chromium.executablePath();
  const context = await chromium.launchPersistentContext(profile, {
    executablePath, headless: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul',
    viewport: {width:1280, height:840}, reducedMotion: 'reduce',
    ignoreDefaultArgs:['--disable-extensions'],
    args:['--load-extension=' + extensionPath, '--disable-background-networking', '--use-in-memory-clipboard', '--enable-unsafe-extension-debugging']
  });
  context.setDefaultTimeout(10000);
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const home = new URL('index.html', worker.url()).href;
    const external = [];
    context.on('request', request => {
      if (!/^(https?|wss?):/.test(request.url())) return;
      const sw = request.serviceWorker();
      let owner = sw?.url();
      try { owner ||= request.frame().url(); } catch {}
      if (owner?.startsWith('chrome-extension:')) external.push(request.url());
    });
    const tab = async (date, folder = 'test-vault') => {
      const page = await context.newPage();
      await page.goto(home + (date ? '?date=' + date : ''));
      if (folder) {
        await page.locator('#storage-start:visible, .workspace:visible, #lock-screen:visible').waitFor();
        if (await page.locator('#choose-first-folder').isVisible()) await selectFolder(page, folder);
        const selected = await page.evaluate(async () => (await import('./vault.js')).folderConnection().directory.name);
        assert.equal(selected, folder);
      }
      return page;
    };
    return {context, home, worker, external, tab};
  } catch (error) { await context.close(); throw error; }
}

async function checkPolicy(session) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.url); res.writeHead(200, {'Content-Type':'text/plain', 'Access-Control-Allow-Origin':'*'}); res.end('ok');
  });
  await new Promise((resolve,reject) => { server.on('error',reject); server.listen(0,'127.0.0.1',resolve); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const control = await session.context.newPage();
  const memo = await session.tab();
  try {
    await control.goto(base + '/control');
    assert.ok(seen.includes('/control'), 'control page must reach the local server');
    for (const target of [memo, session.worker]) {
      const directive = await target.evaluate(async url => {
        const violation = new Promise(resolve => {
          self.addEventListener('securitypolicyviolation', e => resolve(e.effectiveDirective), {once:true});
          setTimeout(() => resolve('missing-event'), 3000);
        });
        try { await fetch(url); return 'unexpected-success'; } catch { return await violation; }
      }, base + '/blocked');
      assert.equal(directive, 'connect-src');
    }
    assert.ok(!seen.includes('/blocked'));
    console.log('PASS  CSP blocked page and worker requests; network control succeeded');
  } finally {
    await control.close(); await memo.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
module.exports = {launch, extension, checkPolicy, selectFolder};
