import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const code = await readFile(new URL('../analytics.js', import.meta.url), 'utf8');
test('analytics makes no DOM/API access before authentication resolves', async () => {
  let resolve;
  const ready = new Promise(r => { resolve = r; });
  const context = vm.createContext({ window: { JUFLOW_AUTH_READY: ready }, document: { getElementById() { assert.fail('unauthenticated DOM access'); } }, JuAPI: { request() { assert.fail('unauthenticated fetch'); } } });
  const result = vm.runInContext(code, context);
  resolve(null);
  await result;
});
test('analytics gracefully waits through auth outages and never reads bearer storage', async () => {
  const context = vm.createContext({ window: { JUFLOW_AUTH_READY: Promise.reject(new Error('offline')) }, document: { getElementById() { assert.fail('DOM access during outage'); } } });
  await vm.runInContext(code, context);
  assert.doesNotMatch(code, /localStorage|Authorization|juflow_token/);
  assert.match(code, /JuAPI\.request\('\/sales\/summary/);
});
test('analytics pages load cookie API client before analytics', async () => {
  for (const name of ['sales', 'dashboard']) {
    const html = await readFile(new URL(`../${name}.html`, import.meta.url), 'utf8');
    assert.ok(html.indexOf('src="/api.js"') >= 0);
    assert.ok(html.indexOf('src="/api.js"') < html.indexOf('src="analytics.js"'));
  }
});
