const test = require('node:test');
const assert = require('node:assert/strict');

const { streamGenerate } = require('../services/aiService');

test('streamGenerate reports an unconfigured route before making a request', async () => {
  await assert.rejects(
    () => streamGenerate('system', 'prompt', null, null, { baseUrl: '', model: '' }),
    (error) => error.isApiError === true && error.message.includes('尚未配置')
  );
});
