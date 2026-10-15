const { AsyncLocalStorage } = require('async_hooks');
const { createHash, randomUUID } = require('crypto');
const mongoose = require('mongoose');
const { resumeGenerationJob, heartbeatGenerationJob, finalizeGenerationJob, getActiveJob } = require('./generationJob');
const context = new AsyncLocalStorage();

function creativeResourceId(key) { return new mongoose.Types.ObjectId(createHash('sha256').update(`creative:${key}`).digest('hex').slice(0, 24)); }
function getCreativeSignal() { return context.getStore()?.signal || null; }
async function isCreativeBusy(key) { return Boolean(await getActiveJob(creativeResourceId(key))); }
async function isScreenplayBusy(id) {
  const prefix = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return Boolean(await require('../models/GenerationJob').exists({ status: { $in: ['running', 'pause_requested'] }, leaseUntil: { $gt: new Date() }, 'metadata.resourceKey': { $regex: `^screenplay:${prefix}:` } }));
}
async function assertCreativeLease() {
  const scope = context.getStore()?.scope;
  if (scope) await heartbeatGenerationJob(scope);
}
async function runCreativeLease({ userId, key, kind }, work) {
  const leaseOwner = randomUUID();
  const job = await resumeGenerationJob({ novelId: creativeResourceId(key), kind, leaseOwner, leaseMs: 120000, metadata: { userId: String(userId), resourceKey: key } });
  const scope = { jobId: job.jobId, leaseOwner, fencingToken: job.fencingToken, leaseMs: 120000 };
  const controller = new AbortController();
  let leaseError = null;
  const timer = setInterval(async () => {
    try { await heartbeatGenerationJob(scope); } catch (error) { leaseError = error; controller.abort(); }
  }, 15000);
  try {
    const result = await context.run({ signal: controller.signal, scope }, work);
    if (leaseError) throw leaseError;
    await finalizeGenerationJob({ ...scope, status: 'completed' });
    return result;
  } catch (error) {
    await finalizeGenerationJob({ ...scope, status: 'failed', error: { message: require('./generationError').redactError(error.message) } }).catch(() => {});
    throw error;
  } finally { clearInterval(timer); }
}
function creativeOperation(kind, handler) {
  return async (req, res, next) => {
    const unit = kind === 'screenplay_episode' ? `episode:${req.params.episodeNumber}` : 'development';
    try {
      if (kind === 'screenplay_develop' && await isScreenplayBusy(req.params.id)) return res.status(409).json({ message: '剧本正在生成，请等待当前任务结束' });
      await runCreativeLease({ userId: req.userId, key: `screenplay:${req.params.id}:${unit}`, kind }, async () => {
      await handler(req, res, next);
      if (res.statusCode >= 400) throw new Error(`创作请求失败（${res.statusCode}）`);
    }); }
    catch (error) {
      if (res.headersSent) return;
      if (error.code === 'GENERATION_LEASE_BUSY') return res.status(409).json({ message: '本剧本任务正在后台生成，请等待或先暂停批量生成' });
      next(error);
    }
  };
}
module.exports = { creativeResourceId, getCreativeSignal, isCreativeBusy, isScreenplayBusy, assertCreativeLease, runCreativeLease, creativeOperation };
