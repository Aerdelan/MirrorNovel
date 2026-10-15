const DEFAULT_IMAGE_GENERATION = Object.freeze({
  models: [
    {
      id: 'image_1',
      alias: '生图模型一',
      baseUrl: '',
      model: 'wan2.7-image',
      apiKey: '',
    },
    {
      id: 'image_2',
      alias: '生图模型二',
      baseUrl: '',
      model: 'wan2.7-image',
      apiKey: '',
    },
  ],
  minIntervalMs: 1500,
});

function normalizeImageGeneration(value = {}) {
  const sourceModels = Array.isArray(value.models) ? value.models : [];
  const models = DEFAULT_IMAGE_GENERATION.models.map((fallback) => {
    const source = sourceModels.find((item) => item?.id === fallback.id) || {};
    return {
      id: fallback.id,
      alias: String(source.alias || fallback.alias).slice(0, 80),
      baseUrl: String(source.baseUrl || '').trim().replace(/\/+$/, ''),
      model: String(source.model || fallback.model).trim().slice(0, 120),
      apiKey: String(source.apiKey || '').trim(),
    };
  });
  const interval = Number(value.minIntervalMs);
  return {
    models,
    minIntervalMs: Number.isFinite(interval) ? Math.max(1000, Math.min(60000, Math.floor(interval))) : DEFAULT_IMAGE_GENERATION.minIntervalMs,
  };
}

function toPublicImageGeneration(value = {}) {
  const normalized = normalizeImageGeneration(value);
  return {
    minIntervalMs: normalized.minIntervalMs,
    models: normalized.models.map((model) => ({
      id: model.id,
      alias: model.alias,
      baseUrl: model.baseUrl,
      model: model.model,
      apiKeyConfigured: Boolean(model.apiKey),
      configured: Boolean(model.baseUrl && model.model && model.apiKey),
    })),
  };
}

module.exports = { DEFAULT_IMAGE_GENERATION, normalizeImageGeneration, toPublicImageGeneration };
