const { normalizeImageGeneration } = require('../config/imageGeneration');
const { open } = require('./secretBox');

let queue = Promise.resolve();
let lastRequestAt = 0;

function imageEndpoint(baseUrl) {
  const value = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!value) return '';
  if (/\/v1\/images\/generations$/i.test(value)) return value;
  if (/\/v1$/i.test(value)) return `${value}/images/generations`;
  return `${value}/v1/images/generations`;
}

function enqueue(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function generateImage({ model, prompt, size = '1024x1024', n = 1, timeoutMs = 180000, minIntervalMs = 1500 }) {
  const endpoint = imageEndpoint(model?.baseUrl);
  if (!endpoint || !model?.model || !model?.apiKey) {
    const error = new Error('生图线路尚未配置地址、模型或密钥');
    error.code = 'IMAGE_ROUTE_UNCONFIGURED';
    throw error;
  }
  const allowedSizes = new Set(['1024x1024', '720x1280', '1280x720', '768x1152', '1152x768']);
  const safeSize = allowedSizes.has(size) ? size : '1024x1024';
  const safeCount = Math.max(1, Math.min(4, Math.floor(Number(n) || 1)));
  return enqueue(async () => {
    const elapsed = Date.now() - lastRequestAt;
    if (elapsed < minIntervalMs) await wait(minIntervalMs - elapsed);
    lastRequestAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(10000, Number(timeoutMs) || 180000));
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${model.apiKey}` },
        body: JSON.stringify({ model: model.model, prompt: String(prompt || '').slice(0, 6000), n: safeCount, size: safeSize }),
        signal: controller.signal,
      });
      const raw = await response.text();
      let payload;
      try { payload = JSON.parse(raw); } catch { payload = null; }
      if (!response.ok) {
        const error = new Error(payload?.error?.message || payload?.message || `生图服务返回 ${response.status}`);
        error.statusCode = response.status;
        throw error;
      }
      const data = Array.isArray(payload?.data) ? payload.data : [];
      const urls = data.map((item) => item?.url || item?.image_url || item?.b64_json ? (item.url || item.image_url || (item.b64_json ? `data:image/png;base64,${item.b64_json}` : '')) : '').filter(Boolean);
      if (!urls.length) throw new Error('生图服务返回为空');
      return { urls, size: safeSize, n: safeCount, rawUsage: payload?.usage || null };
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('生图服务请求超时');
      error.message = require('./generationError').redactError(error.message);
      throw error;
    } finally { clearTimeout(timer); }
  });
}

function chooseImageModel(config, modelId) {
  const normalized = normalizeImageGeneration(config);
  const model = normalized.models.find((model) => model.id === modelId) || normalized.models[0];
  return { ...model, apiKey: open(model.apiKey) };
}

module.exports = { imageEndpoint, generateImage, chooseImageModel };
