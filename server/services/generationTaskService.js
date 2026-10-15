const { randomUUID } = require('crypto');
const GenerationTask = require('../models/GenerationTask');
const { randomUUID: workerUUID } = require('crypto');

function dbReady() { return GenerationTask.db?.readyState === 1; }

function taskKey(kind, resourceId, suffix = '') {
  return `${kind}:${resourceId}:${suffix || randomUUID()}`;
}

async function beginTask({ userId, kind, resourceType, resourceId, idempotencyKey, totalUnits = 0, metadata = {} }) {
  if (!dbReady()) return null;
  const key = idempotencyKey || taskKey(kind, resourceId);
  const task = await GenerationTask.findOneAndUpdate(
    { idempotencyKey: key },
    {
      $setOnInsert: { userId, kind, resourceType, resourceId, idempotencyKey: key, totalUnits, metadata },
      $set: { activeKey: `${kind}:${resourceId}:${metadata.episodeNumber || 'main'}`, status: 'running', stage: 'preparing', progress: '任务已启动', error: '', cancellationRequested: false, startedAt: new Date(), lastHeartbeatAt: new Date() },
      $inc: { retryCount: 1 },
    },
    { new: true, upsert: true }
  );
  return task;
}

async function updateTask(taskId, patch = {}) {
  if (!taskId || !dbReady()) return null;
  const update = { $set: { ...patch, lastHeartbeatAt: new Date() } };
  if (['completed', 'failed', 'cancelled', 'paused'].includes(patch.status)) update.$unset = { activeKey: 1 };
  return GenerationTask.findByIdAndUpdate(taskId, update, { new: true });
}

/** Atomically claim a queued/expired task for a worker. */
async function claimTask({ taskId, workerId = workerUUID(), leaseMs = 120000 } = {}) {
  if (!taskId || !dbReady()) return null;
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + Math.max(10000, Number(leaseMs) || 120000));
  return GenerationTask.findOneAndUpdate(
    {
      _id: taskId,
      cancellationRequested: { $ne: true },
      $or: [
        { status: 'queued' },
        { status: 'paused', leaseExpiresAt: { $lte: now } },
        { status: 'running', leaseExpiresAt: { $lte: now } },
      ],
    },
    { $set: { status: 'running', stage: 'running', workerId, leaseExpiresAt, lastHeartbeatAt: now }, $inc: { attempts: 1 } },
    { new: true }
  );
}

async function heartbeatTask(taskId, { workerId, checkpoint, leaseMs = 120000, ...patch } = {}) {
  if (!taskId || !dbReady()) return null;
  const now = new Date();
  const update = { ...patch, lastHeartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + Math.max(10000, Number(leaseMs) || 120000)) };
  if (workerId) update.workerId = workerId;
  if (checkpoint !== undefined) update.checkpoint = checkpoint;
  const filter = { _id: taskId, status: 'running' };
  if (workerId) filter.workerId = workerId;
  return GenerationTask.findOneAndUpdate(filter, { $set: update }, { new: true });
}

async function completeTask(taskId, patch = {}) {
  return updateTask(taskId, { ...patch, status: 'completed', stage: 'completed', completedAt: new Date(), cancellationRequested: false, leaseExpiresAt: null, workerId: '' });
}

async function pauseTask(taskId, patch = {}) {
  return updateTask(taskId, { ...patch, status: 'paused', stage: 'paused', cancellationRequested: true, leaseExpiresAt: null, workerId: '' });
}

async function failTask(taskId, error, patch = {}) {
  return updateTask(taskId, { ...patch, status: 'failed', stage: 'failed', error: String(error || '任务失败').slice(0, 2000), completedAt: new Date(), leaseExpiresAt: null, workerId: '' });
}

async function requestCancellation({ userId, resourceId }) {
  if (!dbReady()) return null;
  return GenerationTask.findOneAndUpdate(
    { userId, resourceId, status: { $in: ['queued', 'running'] } },
    { $set: { cancellationRequested: true, status: 'paused', stage: 'paused', progress: '已请求暂停', lastHeartbeatAt: new Date() } },
    { sort: { updatedAt: -1 }, new: true }
  );
}

async function getLatestTask({ userId, resourceId, kind }) {
  if (!dbReady()) return null;
  const filter = { userId, resourceId };
  if (kind) filter.kind = kind;
  const active = await GenerationTask.findOne({ ...filter, status: { $in: ['running', 'queued'] } }).sort({ updatedAt: -1 }).lean();
  if (active) return active;
  return GenerationTask.findOne(filter).sort({ updatedAt: -1 }).lean();
}

async function recoverInterruptedTasks() {
  if (!dbReady()) return { modifiedCount: 0 };
  // A process restart cannot resume an in-memory provider stream.  Keep the
  // checkpoint and make the task explicitly resumable instead of pretending
  // it is still running.
  const tasks = await GenerationTask.find({ resourceType: 'screenplay', status: { $in: ['queued', 'running'] } });
  let modifiedCount = 0;
  const { isCreativeBusy } = require('./creativeLease');
  for (const task of tasks) {
    const unit = task.kind === 'screenplay_batch' ? 'batch' : task.kind === 'screenplay_episode' ? `episode:${task.metadata?.episodeNumber}` : 'development';
    if (await isCreativeBusy(`screenplay:${task.resourceId}:${unit}`)) continue;
    await updateTask(task._id, { status: 'paused', stage: 'interrupted', progress: '服务重启，已完成内容保留，可继续生成', error: '', cancellationRequested: false, leaseExpiresAt: null, workerId: '' });
    modifiedCount += 1;
  }
  return { modifiedCount };
}

module.exports = {
  taskKey,
  beginTask,
  updateTask,
  completeTask,
  pauseTask,
  failTask,
  requestCancellation,
  getLatestTask,
  claimTask,
  heartbeatTask,
  recoverInterruptedTasks,
};
