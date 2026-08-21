const test = require('node:test');
const assert = require('node:assert/strict');

const { streamGenerate, resolveApiConfig } = require('../services/aiService');

test('streamGenerate reports an unconfigured route before making a request', async () => {
  await assert.rejects(
    () => streamGenerate('system', 'prompt', null, null, { baseUrl: '', model: '' }),
    (error) => error.isApiError === true && error.message.includes('尚未配置')
  );
});

test('managed route selection uses the configured task role override', () => {
  const config = resolveApiConfig({
    provider: 'system',
    routeId: 'normal_1',
    roleRoutes: { outline: 'vip', polish: 'svip' },
  }, 'polish');
  assert.equal(config.routeId, 'svip');
});

test('writing and polish routes disable deep thinking while reasoning keeps it', () => {
  const writing = resolveApiConfig({ provider: 'system', routeId: 'normal_1' }, 'writing');
  const polish = resolveApiConfig({ provider: 'system', routeId: 'normal_1' }, 'polish');
  const reasoning = resolveApiConfig({ provider: 'system', routeId: 'normal_1' }, 'reasoning');
  assert.equal(writing.disableThinking, true);
  assert.equal(polish.disableThinking, true);
  assert.equal(reasoning.disableThinking, false);
});
