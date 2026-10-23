const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const results = path.join(root, 'test-results');
fs.mkdirSync(results, { recursive: true });
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent(`<!doctype html><html lang="zh-CN"><head><style>
    :root{--dsw-alias-label-primary:#e3e5e9;--dsw-alias-label-secondary:#b7bbc1;--dsw-alias-label-tertiary:#868c95;--dsw-alias-border-l2:#303034;--dsh-content-font-size-secondary:13px}
    body{margin:0;background:#141414;color:#e3e5e9;font:14px/1.6 system-ui} [data-conversation-scroll]{height:100vh;overflow:auto;padding:0 80px;box-sizing:border-box}
    [data-chat-flow],[data-slot]{display:flex;flex-direction:column} [data-chat-flow-key]{flex:none;margin-top:6px;min-width:0}
    .bubble{margin:24px 0 0 auto;width:fit-content;max-width:70%;padding:12px 16px;background:#2b2b2d;border-radius:18px}
    button[data-turn-process]{color:#aaa;background:transparent;border:0;border-bottom:.5px solid #303034;text-align:left;width:100%;height:33px;padding:0;cursor:pointer}
    .reply{padding:12px 0 24px} [data-native-process-body][hidden]{display:none}
  </style></head><body><div data-conversation-scroll><div data-chat-flow><div data-slot="conversation.chat.flow"></div></div><div data-chat-turn-spacer style="height:0px"></div></div></body></html>`);
  await page.evaluate(() => {
    const source = (value) => ({ value, listeners: new Set(), getSnapshot() { return this.value; }, subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }, emit() { for (const fn of this.listeners) fn(); } });
    window.makeSource = source;
    window.fixtureUsage = new Map([
      [1, { totalTokens: 28600, outputTokens: 1600, uncachedInputTokens: 1350, cacheReadTokens: 25650, cacheWriteTokens: 0, reasoningTokens: 800 }],
      [2, { totalTokens: 1200, outputTokens: 200, uncachedInputTokens: 1000 }],
      [3, { totalTokens: 1000, outputTokens: 200, uncachedInputTokens: 800, cacheReadTokens: 0, cacheWriteTokens: 0 }],
    ]);
    window.snapshot = () => ({ timeline: { turns: new Map([...fixtureUsage].map(([turn, tokenUsage]) => [turn, { data: new Map([['turn-tail', { tokenUsage }]]) }])) } });
    window.chat = source(snapshot());
    window.current = source({ key: 'test-session-a', hooks: { chat } });
    window.ctx = { uiSession: { adapter: { current } }, effect(factory) { window.teardown = factory(); } };
    window.__ModuleLoader__ = { load({ factory }) { window.plugin = factory(); } };
    window.addTurn = (turn, message) => {
      const flow = document.querySelector('[data-slot]');
      const row = (kind) => {
        const el = document.createElement('div');
        el.setAttribute('data-chat-flow-key', `${kind}-${turn}`);
        el.setAttribute('data-chat-node-key', `${kind}-${turn}`);
        el.setAttribute('data-chat-flow-kind', kind);
        el.setAttribute('data-chat-turn', String(turn));
        flow.appendChild(el); return el;
      };
      row('user').innerHTML = '<div class="bubble"></div>';
      flow.lastElementChild.firstElementChild.textContent = message;
      const process = row('turn-process');
      process.innerHTML = '<button data-turn-process aria-expanded="false">已完成，用时 1分36秒 ﹀</button><div data-native-process-body hidden>示例过程内容</div>';
      const button = process.querySelector('button');
      button.onclick = () => { const open = button.getAttribute('aria-expanded') !== 'true'; button.setAttribute('aria-expanded', String(open)); process.lastElementChild.hidden = !open; };
      row('assistant-step').innerHTML = '<div class="reply">这是本轮回复正文。展开回复时，原生思考过程仍保持折叠。</div>';
      row('turn-tail').textContent = '复制　用量明细';
    };
    for (let turn = 1; turn <= 4; turn++) addTurn(turn, `第 ${turn} 条用户消息`);
  });
  await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'lib/client.js'), 'utf8') });
  await page.evaluate(() => plugin.apply(ctx));
  const head = (turn) => page.locator(`[data-chat-flow-kind="user"][data-chat-turn="${turn}"]`);
  const button = (turn) => head(turn).locator('[data-dsh-fold-button]');
  const process = (turn) => page.locator(`[data-chat-flow-kind="turn-process"][data-chat-turn="${turn}"]`);
  const reply = (turn) => page.locator(`[data-chat-flow-kind="assistant-step"][data-chat-turn="${turn}"]`);
  await page.waitForFunction(() => document.querySelectorAll('[data-dsh-fold-button]').length === 3);
  assert.equal(await reply(1).isVisible(), false);
  assert.equal(await reply(4).isVisible(), true);
  assert.equal(await head(4).locator('[data-dsh-fold-button]').count(), 0);
  assert.match(await button(1).innerText(), /28\.6K tok/);
  assert.match(await button(1).innerText(), /缓存命中 95%/);
  assert.match(await button(2).innerText(), /缓存命中 —/);
  assert.match(await button(3).innerText(), /缓存命中 0%/);
  const geometry = await head(1).evaluate((el) => {
    const root = el.querySelector('[data-dsh-fold-control]');
    return { left: root.getBoundingClientRect().left, head: el.getBoundingClientRect().left, padding: getComputedStyle(root).paddingBottom, margin: getComputedStyle(root).marginBottom, primary: getComputedStyle(root.querySelector('[data-dsh-fold-total]')).color, secondary: getComputedStyle(root.querySelector('[data-dsh-fold-cache]')).color };
  });
  assert.equal(geometry.left, geometry.head);
  assert.equal(geometry.padding, '12px');
  assert.equal(geometry.margin, '28px');
  assert.notEqual(geometry.primary, geometry.secondary);
  await button(1).hover();
  await page.waitForFunction(() => !document.querySelector('[data-dsh-fold-tooltip]').hidden);
  const details = await page.locator('[data-dsh-fold-tooltip]').innerText();
  for (const value of ['28,600 tok', '1,350', '25,650', '1,600', '其中推理', '800', '点击展开回复']) assert.ok(details.includes(value), value);
  await page.screenshot({ path: path.join(results, 'collapsed.png'), fullPage: true });
  await button(1).click();
  assert.equal(await button(1).getAttribute('aria-expanded'), 'true');
  assert.equal(await reply(1).isVisible(), true);
  assert.equal(await process(1).isVisible(), true);
  assert.equal(await process(1).locator('button').getAttribute('aria-expanded'), 'false');
  assert.equal(await head(1).locator('[data-dsh-fold-control]').evaluate((el) => getComputedStyle(el).borderBottomWidth), '0px');
  await process(1).locator('button').click();
  assert.equal(await button(1).getAttribute('aria-expanded'), 'true');
  assert.equal(await process(1).locator('button').getAttribute('aria-expanded'), 'true');
  await button(1).click();
  assert.equal(await process(1).locator('button').getAttribute('aria-expanded'), 'false');
  await button(1).focus();
  await page.keyboard.press('Enter');
  assert.equal(await button(1).getAttribute('aria-expanded'), 'true');
  assert.equal(await process(1).locator('button').getAttribute('aria-expanded'), 'false');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-dsh-fold-tooltip]').isVisible(), false);
  await page.screenshot({ path: path.join(results, 'expanded.png'), fullPage: true });
  await page.evaluate(() => addTurn(5, '新的用户消息'));
  await page.waitForFunction(() => document.querySelector('[data-chat-flow-kind="user"][data-chat-turn="4"] [data-dsh-fold-button]') !== null);
  assert.equal(await reply(4).isVisible(), false);
  assert.equal(await reply(5).isVisible(), true);
  assert.equal(await button(1).getAttribute('aria-expanded'), 'true');
  await page.evaluate(() => { current.value = { key: 'test-session-b', hooks: { chat: makeSource({ timeline: { turns: new Map() } }) } }; current.emit(); });
  await page.waitForFunction(() => document.querySelector('[data-dsh-fold-total]')?.textContent === '用量 —');
  assert.equal(await button(1).getAttribute('aria-expanded'), 'false');
  await page.evaluate(() => teardown());
  assert.equal(await page.locator('[data-dsh-fold-control],[data-dsh-fold-tooltip],[data-dsh-fold],[data-dsh-fold-head],style[data-dsh-fold-turns]').count(), 0);
  assert.equal(await page.evaluate(() => current.listeners.size), 0);
  assert.equal(await page.evaluate(() => chat.listeners.size), 0);
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(results, 'integration.json'), JSON.stringify({ passed: true, checks: ['older-turn folding', 'latest-turn visibility', 'native per-turn totals', 'unknown cache versus zero', 'alignment and spacing', 'visual hierarchy', 'hover details', 'independent inner disclosure', 'single expanded divider', 'keyboard operation', 'new-turn folding', 'session-switch isolation', 'complete cleanup'], geometry }, null, 2));
  console.log('PASS: 13 integration checks, no browser errors.');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
