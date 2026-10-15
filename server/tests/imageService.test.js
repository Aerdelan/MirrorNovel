const test = require('node:test');
const assert = require('node:assert/strict');

const {
  imageEndpoint,
  generateImage,
  chooseImageModel,
} = require('../services/imageService');
const {
  DEFAULT_IMAGE_GENERATION,
  normalizeImageGeneration,
} = require('../config/imageGeneration');

test('image endpoint accepts base URL and full generations URL', () => {
  assert.equal(imageEndpoint('http://127.0.0.1:8787'), 'http://127.0.0.1:8787/v1/images/generations');
  assert.equal(imageEndpoint('http://127.0.0.1:8787/v1/'), 'http://127.0.0.1:8787/v1/images/generations');
  assert.equal(imageEndpoint('http://127.0.0.1:8787/v1/images/generations'), 'http://127.0.0.1:8787/v1/images/generations');
});

test('image config normalizes model values and keeps two independent routes', () => {
  const config = normalizeImageGeneration({
    minIntervalMs: 20,
    models: [{ id: 'image_1', baseUrl: 'http://image.test/v1/', apiKey: 'secret', pointsPerImage: 12.8 }],
  });
  assert.equal(config.minIntervalMs, 1000);
  assert.equal(config.models.length, 2);
  assert.equal(config.models[0].baseUrl, 'http://image.test/v1');
  assert.equal(config.models[0].pointsPerImage, undefined, 'creative migration does not introduce points pricing');
  assert.equal(config.models[1].alias, DEFAULT_IMAGE_GENERATION.models[1].alias);
  assert.equal(chooseImageModel(config, 'image_2').id, 'image_2');
});

test('image generation clamps count and parses URL and base64 responses', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({
      data: [
        { url: 'https://image.test/one.png' },
        { b64_json: 'YWJj' },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await generateImage({
      model: { baseUrl: 'http://image.test/v1', model: 'wan2.7-image', apiKey: 'key' },
      prompt: 'test',
      size: 'not-allowed',
      n: 99,
      minIntervalMs: 0,
    });
    assert.equal(requests[0].size, '1024x1024');
    assert.equal(requests[0].n, 4);
    assert.deepEqual(result.urls, ['https://image.test/one.png', 'data:image/png;base64,YWJj']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('image generation queue serializes requests', async () => {
  const originalFetch = global.fetch;
  let active = 0;
  let maxActive = 0;
  global.fetch = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    active -= 1;
    return new Response(JSON.stringify({ data: [{ url: 'https://image.test/ok.png' }] }), { status: 200 });
  };
  try {
    await Promise.all([
      generateImage({ model: { baseUrl: 'http://image.test/v1', model: 'm', apiKey: 'k' }, prompt: 'a', minIntervalMs: 0 }),
      generateImage({ model: { baseUrl: 'http://image.test/v1', model: 'm', apiKey: 'k' }, prompt: 'b', minIntervalMs: 0 }),
    ]);
    assert.equal(maxActive, 1);
  } finally {
    global.fetch = originalFetch;
  }
});
