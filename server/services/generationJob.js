const crypto = require('crypto');
const GenerationJob = require('../models/GenerationJob');

const DEFAULT_LEASE_MS = 30_000;
const MAX_GENERATION_EVENTS = 200;
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const RELEASE_STATUSES = new Set(['queued', 'paused']);
const ACTIVE_STATUSES = ['running', 'pause_requested'];

class GenerationJobError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    Object.assign(this, details);
  }
}

class LeaseBusyError extends GenerationJobError {
  constructor(novelId) {
    super(`Novel ${novelId} already has an active generation lease`, 'GENERATION_LEASE_BUSY', { novelId });
  }
}

class StaleLeaseError extends GenerationJobError {
  constructor(jobId) {
    super(`Generation lease is stale or no longer owned for job ${jobId}`, 'GENERATION_LEASE_STALE', { jobId });
  }
}

class InvalidJobTransitionError extends GenerationJobError {
  constructor(jobId, message) {
    super(message || `Generation job ${jobId} cannot make that transition`, 'GENERATION_JOB_INVALID_TRANSITION', { jobId });
  }
}

function asDate(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) throw new TypeError('now must be a valid date');
  return date;
}

function positiveLeaseMs(value) {
  const leaseMs = Number(value ?? DEFAULT_LEASE_MS);
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new TypeError('leaseMs must be positive');
  return leaseMs;
}

function requiredText(value, field) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${field} is required`);
  return text;
}

function leaseKeyFor(novelId) {
  return requiredText(novelId, 'novelId');
}

function modelFrom(options) {
  return options?.GenerationJobModel || GenerationJob;
}

function isDuplicateKey(error) {
  return error?.code === 11000 || error?.code === 11001;
}

function plainValue(document, key) {
  if (!document) return undefined;
  if (typeof document.get === 'function') return document.get(key);
  return document[key];
}

function checkpointHash(mode, draftSeq, value) {
  return crypto
    .createHash('sha256')
    .update(`${mode}\0${draftSeq}\0${String(value ?? '')}`)
    .digest('hex');
}

function withPauseRequested(job) {
  if (job && plainValue(job, 'pauseRequested') == null) {
    // Plain-object/in-memory adapters do not run the Mongoose virtual.
    job.pauseRequested = plainValue(job, 'status') === 'pause_requested';
  }
  return job;
}

function normalizeTokenUsageDelta(delta) {
  if (!delta || typeof delta !== 'object' || Array.isArray(delta)) return {};
  const increments = {};
  for (const [rawKey, rawValue] of Object.entries(delta)) {
    // Dot/$ keys would let an untrusted provider response alter another field.
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(rawKey)) continue;
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value <= 0) continue;
    increments[`tokenUsage.${rawKey}`] = value;
  }
  return increments;
}

const EVENT_TEXT_KEYS = new Set([
  'content', 'draft', 'text', 'output', 'chaptercontent', 'partialcontent', 'generatedtext',
]);

function sanitizeEventPayload(value, depth = 0) {
  if (depth > 5 || value == null) return value == null ? value : '[truncated]';
  if (typeof value === 'string') return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeEventPayload(item, depth + 1));
  if (typeof value !== 'object') return String(value);
  const clean = {};
  for (const [key, nested] of Object.entries(value)) {
    if (EVENT_TEXT_KEYS.has(key.toLowerCase())) continue;
    clean[key] = sanitizeEventPayload(nested, depth + 1);
  }
  return clean;
}

/**
 * Idempotently creates a durable job. Concurrent callers with the same key get
 * the same document; `$setOnInsert` guarantees an existing job is never reset.
 */
async function createGenerationJob(input, options = {}) {
  const Model = modelFrom(options);
  const idempotencyKey = requiredText(input?.idempotencyKey, 'idempotencyKey');
  const novelId = requiredText(input?.novelId, 'novelId');
  const kind = requiredText(input?.kind, 'kind');
  const now = asDate(options.now);
  const jobIdFactory = options.jobIdFactory || (() => crypto.randomUUID());

  const inserted = {
    jobId: requiredText(input.jobId || jobIdFactory(), 'jobId'),
    idempotencyKey,
    novelId: input.novelId,
    kind,
    status: 'queued',
    phase: input.phase || 'queued',
    draftPhase: input.draftPhase || input.phase || 'queued',
    chapterNumber: Math.max(0, Number(input.chapterNumber) || 0),
    draft: String(input.draft || ''),
    draftSeq: Math.max(0, Number(input.draftSeq) || 0),
    lastCommittedChapter: Math.max(0, Number(input.lastCommittedChapter) || 0),
    fencingToken: 0,
    heartbeat: null,
    error: null,
    tokenUsage: input.tokenUsage || {
      promptTokens: 0,
      completionTokens: 0,
      reasoningTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
      calls: 0,
      failedCalls: 0,
      discardedTokens: 0,
    },
    metadata: input.metadata || {},
    createdAt: now,
    updatedAt: now,
  };

  try {
    return await Model.findOneAndUpdate(
      { idempotencyKey },
      { $setOnInsert: inserted },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    // A concurrent upsert can lose the unique-index race. Read the winner.
    if (!isDuplicateKey(error)) throw error;
    const existing = await Model.findOne({ idempotencyKey });
    if (existing) return existing;
    throw error;
  }
}

/**
 * Releases expired ownership and invalidates the timed-out worker's fencing
 * token. A pause request survives a crash as `paused`; an interrupted running
 * job becomes `queued` and can be reclaimed by a worker.
 */
async function recoverExpiredLeases(input = {}, options = {}) {
  const Model = modelFrom(options);
  const now = asDate(options.now);
  const scope = {
    leaseKey: { $exists: true },
    leaseUntil: { $lte: now },
  };
  if (input.novelId != null) scope.novelId = input.novelId;

  const commonUpdate = {
    $set: { releasedAt: now, updatedAt: now },
    $unset: { leaseKey: '', leaseOwner: '', leaseUntil: '' },
    $inc: { fencingToken: 1 },
  };
  const paused = await Model.updateMany(
    { ...scope, status: 'pause_requested' },
    { ...commonUpdate, $set: { ...commonUpdate.$set, status: 'paused', phase: 'paused' } },
  );
  const queued = await Model.updateMany(
    { ...scope, status: 'running' },
    { ...commonUpdate, $set: { ...commonUpdate.$set, status: 'queued', phase: 'recoverable' } },
  );

  return Number(paused?.modifiedCount || 0) + Number(queued?.modifiedCount || 0);
}

/** Acquire a database-enforced, novel-exclusive lease. */
async function acquireGenerationJob(input, options = {}) {
  const Model = modelFrom(options);
  const jobId = requiredText(input?.jobId, 'jobId');
  const novelId = requiredText(input?.novelId, 'novelId');
  const leaseOwner = requiredText(input?.leaseOwner, 'leaseOwner');
  const now = asDate(options.now);
  const leaseMs = positiveLeaseMs(input.leaseMs ?? options.leaseMs);
  const leaseUntil = new Date(now.getTime() + leaseMs);

  await recoverExpiredLeases({ novelId: input.novelId }, { ...options, now });

  const set = {
    status: 'running',
    leaseKey: leaseKeyFor(input.novelId),
    leaseOwner,
    leaseUntil,
    heartbeat: now,
    acquiredAt: now,
    releasedAt: null,
    updatedAt: now,
  };
  if (input.phase) set.phase = String(input.phase);

  try {
    const job = await Model.findOneAndUpdate(
      {
        jobId,
        novelId: input.novelId,
        status: { $in: ['queued', 'paused', 'running'] },
        $or: [
          { leaseKey: { $exists: false } },
          { leaseKey: null },
          { leaseUntil: { $lte: now } },
        ],
      },
      { $set: set, $inc: { fencingToken: 1, attempt: 1 } },
      { new: true },
    );
    if (!job) {
      // Retrying the same acquire request is idempotent and must not fence the
      // worker that already owns this exact job.
      const existing = await Model.findOne({
        jobId,
        novelId: input.novelId,
        leaseOwner,
        status: { $in: ACTIVE_STATUSES },
        leaseKey: leaseKeyFor(input.novelId),
        leaseUntil: { $gt: now },
      });
      if (existing) return existing;
      throw new LeaseBusyError(novelId);
    }
    return job;
  } catch (error) {
    if (error instanceof LeaseBusyError) throw error;
    if (isDuplicateKey(error)) throw new LeaseBusyError(novelId);
    throw error;
  }
}

async function heartbeatGenerationJob(input, options = {}) {
  const Model = modelFrom(options);
  const jobId = requiredText(input?.jobId, 'jobId');
  const leaseOwner = requiredText(input?.leaseOwner, 'leaseOwner');
  const fencingToken = Number(input?.fencingToken);
  const now = asDate(options.now);
  const leaseMs = positiveLeaseMs(input.leaseMs ?? options.leaseMs);
  const job = await Model.findOneAndUpdate(
    {
      jobId,
      fencingToken,
      leaseOwner,
      status: { $in: ACTIVE_STATUSES },
      leaseKey: { $exists: true },
      leaseUntil: { $gt: now },
    },
    { $set: { heartbeat: now, leaseUntil: new Date(now.getTime() + leaseMs), updatedAt: now } },
    { new: true },
  );
  if (!job) throw new StaleLeaseError(jobId);
  return withPauseRequested(job);
}

/** External/control-plane pause request. The current owner remains responsible for checkpoint + release. */
async function requestPauseGenerationJob(input, options = {}) {
  const Model = modelFrom(options);
  const jobId = requiredText(input?.jobId, 'jobId');
  const now = asDate(options.now);
  const filter = { jobId, status: { $in: ['running', 'pause_requested'] } };
  if (input.novelId != null) filter.novelId = input.novelId;
  let job = await Model.findOneAndUpdate(
    filter,
    { $set: { status: 'pause_requested', pauseRequestedAt: now, updatedAt: now } },
    { new: true },
  );
  if (job) return job;

  // A queued job owns no work yet, so pausing it is immediately safe.
  const queuedFilter = { jobId, status: { $in: ['queued', 'paused'] } };
  if (input.novelId != null) queuedFilter.novelId = input.novelId;
  job = await Model.findOneAndUpdate(
    queuedFilter,
    { $set: { status: 'paused', phase: 'paused', pauseRequestedAt: now, updatedAt: now } },
    { new: true },
  );
  if (!job) throw new InvalidJobTransitionError(jobId, `Cannot pause generation job ${jobId}`);
  return job;
}

/** Atomically stores a monotonically-sequenced partial chapter and renews the lease. */
async function checkpointGenerationJob(input, options = {}) {
  const Model = modelFrom(options);
  const jobId = requiredText(input?.jobId, 'jobId');
  const leaseOwner = requiredText(input?.leaseOwner, 'leaseOwner');
  const fencingToken = Number(input?.fencingToken);
  const draftSeq = Number(input?.draftSeq);
  if (!Number.isSafeInteger(draftSeq) || draftSeq <= 0) throw new TypeError('draftSeq must be a positive integer');
  const now = asDate(options.now);
  const leaseMs = positiveLeaseMs(input.leaseMs ?? options.leaseMs);

  const set = {
    draft: String(input.draft ?? ''),
    draftSeq,
    draftCheckpointHash: checkpointHash('replace', draftSeq, input.draft),
    heartbeat: now,
    leaseUntil: new Date(now.getTime() + leaseMs),
    updatedAt: now,
  };
  if (input.phase != null) {
    set.phase = String(input.phase);
    set.draftPhase = String(input.phase);
  }
  if (input.chapterNumber != null) set.chapterNumber = Math.max(0, Number(input.chapterNumber) || 0);
  const update = { $set: set };
  if (input.lastCommittedChapter != null) {
    update.$max = { lastCommittedChapter: Math.max(0, Number(input.lastCommittedChapter) || 0) };
  }
  const increments = normalizeTokenUsageDelta(input.tokenUsageDelta);
  if (Object.keys(increments).length) update.$inc = increments;

  const job = await Model.findOneAndUpdate(
    {
      jobId,
      fencingToken,
      leaseOwner,
      status: { $in: ACTIVE_STATUSES },
      leaseKey: { $exists: true },
      leaseUntil: { $gt: now },
      $or: [{ draftSeq: { $lt: draftSeq } }, { draftSeq: { $exists: false } }],
    },
    update,
    { new: true },
  );
  if (job) return job;

  // Network retries of an already committed checkpoint are idempotent.
  const current = await Model.findOne({ jobId, fencingToken, leaseOwner, draftSeq });
  if (
    current
    && plainValue(current, 'draftCheckpointHash') === checkpointHash('replace', draftSeq, input.draft)
  ) return current;
  throw new StaleLeaseError(jobId);
}

/**
 * Atomically appends a stream fragment. The sequence/hash pair makes a retried
 * request a read of the prior result instead of duplicating text.
 */
async function appendGenerationDraft(input, options = {}) {
  const Model = modelFrom(options);
  const jobId = requiredText(input?.jobId, 'jobId');
  const leaseOwner = requiredText(input?.leaseOwner, 'leaseOwner');
  const fencingToken = Number(input?.fencingToken);
  const draftSeq = Number(input?.draftSeq);
  if (!Number.isSafeInteger(draftSeq) || draftSeq <= 0) throw new TypeError('draftSeq must be a positive integer');
  const chunk = String(input.chunk ?? '');
  const hash = checkpointHash('append', draftSeq, chunk);
  const now = asDate(options.now);
  const leaseMs = positiveLeaseMs(input.leaseMs ?? options.leaseMs);

  const setExpression = {
    draft: { $concat: [{ $ifNull: ['$draft', ''] }, chunk] },
    draftSeq,
    draftCheckpointHash: hash,
    heartbeat: now,
    leaseUntil: new Date(now.getTime() + leaseMs),
    updatedAt: now,
  };
  if (input.phase != null) {
    setExpression.phase = String(input.phase);
    setExpression.draftPhase = String(input.phase);
  }
  if (input.chapterNumber != null) setExpression.chapterNumber = Math.max(0, Number(input.chapterNumber) || 0);
  if (input.lastCommittedChapter != null) {
    setExpression.lastCommittedChapter = {
      $max: [{ $ifNull: ['$lastCommittedChapter', 0] }, Math.max(0, Number(input.lastCommittedChapter) || 0)],
    };
  }
  for (const [path, amount] of Object.entries(normalizeTokenUsageDelta(input.tokenUsageDelta))) {
    setExpression[path] = { $add: [{ $ifNull: [`$${path}`, 0] }, amount] };
  }

  const job = await Model.findOneAndUpdate(
    {
      jobId,
      fencingToken,
      leaseOwner,
      status: { $in: ACTIVE_STATUSES },
      leaseKey: { $exists: true },
      leaseUntil: { $gt: now },
      $or: [{ draftSeq: { $lt: draftSeq } }, { draftSeq: { $exists: false } }],
    },
    [{ $set: setExpression }],
    { new: true },
  );
  if (job) return job;

  const current = await Model.findOne({ jobId, fencingToken, leaseOwner, draftSeq });
  if (current && plainValue(current, 'draftCheckpointHash') === hash) return current;
  throw new StaleLeaseError(jobId);
}

/** Complete/fail/cancel a job and release its lease in the same atomic update. */
async function finalizeGenerationJob(input, options = {}) {
  const Model = modelFrom(options);
  const jobId = requiredText(input?.jobId, 'jobId');
  const status = requiredText(input?.status, 'status');
  if (!TERMINAL_STATUSES.has(status)) {
    throw new InvalidJobTransitionError(jobId, `Final status must be completed, failed, or cancelled (got ${status})`);
  }
  const fencingToken = Number(input?.fencingToken);
  const now = asDate(options.now);
  const filter = {
    jobId,
    fencingToken,
    status: { $in: ACTIVE_STATUSES },
    leaseKey: { $exists: true },
    leaseUntil: { $gt: now },
  };
  if (input.leaseOwner != null) filter.leaseOwner = requiredText(input.leaseOwner, 'leaseOwner');

  const set = {
    status,
    phase: input.phase || status,
    error: input.error ?? (status === 'failed' ? { message: 'Generation failed' } : null),
    finishedAt: now,
    releasedAt: now,
    updatedAt: now,
  };
  if (input.tokenUsage != null) set.tokenUsage = input.tokenUsage;
  if (input.draft != null) set.draft = String(input.draft);
  const update = {
    $set: set,
    $unset: { leaseKey: '', leaseOwner: '', leaseUntil: '' },
  };
  if (input.lastCommittedChapter != null) {
    update.$max = { lastCommittedChapter: Math.max(0, Number(input.lastCommittedChapter) || 0) };
  }

  const job = await Model.findOneAndUpdate(filter, update, { new: true });
  if (!job) throw new StaleLeaseError(jobId);
  return job;
}

/** Yield an owned lease without marking the generation as terminal. */
async function releaseGenerationJob(input, options = {}) {
  const Model = modelFrom(options);
  const jobId = requiredText(input?.jobId, 'jobId');
  const nextStatus = input?.status || 'paused';
  if (!RELEASE_STATUSES.has(nextStatus)) {
    throw new InvalidJobTransitionError(jobId, `Release status must be queued or paused (got ${nextStatus})`);
  }
  const fencingToken = Number(input?.fencingToken);
  const now = asDate(options.now);
  const filter = {
    jobId,
    fencingToken,
    status: { $in: ACTIVE_STATUSES },
    leaseKey: { $exists: true },
    leaseUntil: { $gt: now },
  };
  if (input.leaseOwner != null) filter.leaseOwner = requiredText(input.leaseOwner, 'leaseOwner');
  const job = await Model.findOneAndUpdate(
    filter,
    {
      $set: {
        status: nextStatus,
        phase: input.phase || nextStatus,
        releasedAt: now,
        updatedAt: now,
      },
      $unset: { leaseKey: '', leaseOwner: '', leaseUntil: '' },
    },
    { new: true },
  );
  if (!job) throw new StaleLeaseError(jobId);
  return job;
}

async function getGenerationJob(jobId, options = {}) {
  return modelFrom(options).findOne({ jobId: requiredText(jobId, 'jobId') });
}

/** Append a small reconnect event to the bounded per-job ring buffer. */
async function appendGenerationEvent(input, options = {}) {
  const Model = modelFrom(options);
  const jobId = requiredText(input?.jobId, 'jobId');
  const type = requiredText(input?.type, 'type');
  const now = asDate(options.now);
  const filter = { jobId };
  if (input.fencingToken != null) filter.fencingToken = Number(input.fencingToken);
  if (input.leaseOwner != null) filter.leaseOwner = requiredText(input.leaseOwner, 'leaseOwner');
  const nextSeq = { $add: [{ $ifNull: ['$eventSeq', 0] }, 1] };
  const event = {
    seq: nextSeq,
    type,
    payload: sanitizeEventPayload(input.payload || {}),
    createdAt: now,
  };
  const job = await Model.findOneAndUpdate(
    filter,
    [{
      $set: {
        eventSeq: nextSeq,
        events: {
          $slice: [
            { $concatArrays: [{ $ifNull: ['$events', []] }, [event]] },
            -MAX_GENERATION_EVENTS,
          ],
        },
        updatedAt: now,
      },
    }],
    { new: true },
  );
  if (!job) throw new StaleLeaseError(jobId);
  return job;
}

async function readGenerationEvents(jobId, afterSeq = 0, options = {}) {
  const job = await modelFrom(options).findOne({ jobId: requiredText(jobId, 'jobId') });
  if (!job) return [];
  const threshold = Math.max(0, Number(afterSeq) || 0);
  const events = plainValue(job, 'events') || [];
  return Array.from(events)
    .filter((event) => Number(plainValue(event, 'seq')) > threshold)
    .slice(-MAX_GENERATION_EVENTS);
}

async function getActiveJob(novelId, options = {}) {
  const now = asDate(options.now);
  return modelFrom(options)
    .findOne({
      novelId,
      status: { $in: ACTIVE_STATUSES },
      leaseKey: { $exists: true },
      leaseUntil: { $gt: now },
    })
    .sort({ acquiredAt: -1, updatedAt: -1 });
}

async function findLatestResumableJob(novelId, kind, options = {}) {
  const filter = { novelId, status: { $in: ['queued', 'paused', 'failed'] } };
  if (kind) filter.kind = kind;
  return modelFrom(options)
    .findOne(filter)
    .sort({ updatedAt: -1, createdAt: -1 });
}

async function recoverExpiredJobs(options = {}) {
  return recoverExpiredLeases({}, options);
}

/**
 * A cross-process double click can race like this: both requests observe no
 * active lease, both create a queued job, and only one wins the sparse unique
 * lease index.  The losing empty job must not remain resumable, otherwise a
 * later, unrelated click would unexpectedly execute that stale request.
 *
 * Never supersede a job that contains a checkpoint: preserving user prose is
 * more important than tidying a duplicate control-plane request.
 */
async function cancelEmptyQueuedDuplicate(input, options = {}) {
  const Model = modelFrom(options);
  const now = asDate(options.now);
  const filter = {
    novelId: input.novelId,
    kind: input.kind,
    status: 'queued',
    draft: '',
    draftSeq: 0,
    $or: [{ leaseKey: { $exists: false } }, { leaseKey: null }],
  };
  if (input.jobId) filter.jobId = input.jobId;
  return Model.findOneAndUpdate(
    filter,
    {
      $set: {
        status: 'cancelled',
        phase: 'superseded_duplicate',
        error: { code: 'GENERATION_DUPLICATE_REQUEST', message: 'Superseded by another active generation request' },
        finishedAt: now,
        releasedAt: now,
        updatedAt: now,
      },
    },
    { new: true, sort: { updatedAt: -1, createdAt: -1 } },
  );
}

/**
 * Resume the latest durable draft for a novel. The lease acquisition is the
 * same atomic update as the status transition, so the previous draft cannot be
 * cleared between selecting and owning the job. If none exists, create a new
 * idempotent job and acquire it.
 */
async function resumeGenerationJob(input, options = {}) {
  const Model = modelFrom(options);
  const novelId = requiredText(input?.novelId, 'novelId');
  const kind = requiredText(input?.kind, 'kind');
  const leaseOwner = requiredText(input?.leaseOwner, 'leaseOwner');
  const now = asDate(options.now);
  const leaseMs = positiveLeaseMs(input.leaseMs ?? options.leaseMs);
  const leaseUntil = new Date(now.getTime() + leaseMs);

  await recoverExpiredLeases({ novelId: input.novelId }, { ...options, now });

  try {
    const resumed = await Model.findOneAndUpdate(
      {
        novelId: input.novelId,
        kind,
        status: { $in: ['queued', 'paused', 'failed'] },
        $or: [{ leaseKey: { $exists: false } }, { leaseKey: null }, { leaseUntil: { $lte: now } }],
      },
      {
        $set: {
          status: 'running',
          phase: input.phase || 'resuming',
          leaseKey: leaseKeyFor(input.novelId),
          leaseOwner,
          leaseUntil,
          heartbeat: now,
          acquiredAt: now,
          releasedAt: null,
          finishedAt: null,
          error: null,
          updatedAt: now,
        },
        $inc: { fencingToken: 1, attempt: 1 },
      },
      { new: true, sort: { updatedAt: -1, createdAt: -1 } },
    );
    if (resumed) return resumed;
  } catch (error) {
    if (isDuplicateKey(error)) {
      // A different worker won the per-novel lease between selection and
      // update. Retire only an empty queued loser; checkpointed work remains
      // available for explicit recovery.
      try { await cancelEmptyQueuedDuplicate({ novelId: input.novelId, kind }, { ...options, now }); } catch {}
      throw new LeaseBusyError(novelId);
    }
    throw error;
  }

  const active = await getActiveJob(input.novelId, { ...options, now });
  if (active) throw new LeaseBusyError(novelId);

  const idempotencyKey = input.idempotencyKey
    || `resume:${novelId}:${kind}:${input.resumeRequestId || crypto.randomUUID()}`;
  const created = await createGenerationJob({
    novelId: input.novelId,
    kind,
    idempotencyKey,
    chapterNumber: input.chapterNumber,
    lastCommittedChapter: input.lastCommittedChapter,
    phase: input.phase || 'queued',
    metadata: input.metadata,
  }, { ...options, now });
  const createdJobId = plainValue(created, 'jobId');
  try {
    return await acquireGenerationJob({
      jobId: createdJobId,
      novelId: input.novelId,
      leaseOwner,
      leaseMs,
      phase: input.phase || 'starting',
    }, { ...options, now });
  } catch (error) {
    if (error instanceof LeaseBusyError || error?.code === 'GENERATION_LEASE_BUSY') {
      try {
        await cancelEmptyQueuedDuplicate({
          novelId: input.novelId,
          kind,
          jobId: createdJobId,
        }, { ...options, now });
      } catch {}
    }
    throw error;
  }
}

module.exports = {
  DEFAULT_LEASE_MS,
  MAX_GENERATION_EVENTS,
  GenerationJobError,
  LeaseBusyError,
  StaleLeaseError,
  InvalidJobTransitionError,
  createGenerationJob,
  recoverExpiredLeases,
  acquireGenerationJob,
  heartbeatGenerationJob,
  requestPauseGenerationJob,
  checkpointGenerationJob,
  replaceGenerationDraft: checkpointGenerationJob,
  appendGenerationDraft,
  finalizeGenerationJob,
  releaseGenerationJob,
  getGenerationJob,
  appendGenerationEvent,
  readGenerationEvents,
  appendEvent: appendGenerationEvent,
  readEvents: readGenerationEvents,
  getActiveJob,
  findLatestResumableJob,
  recoverExpiredJobs,
  cancelEmptyQueuedDuplicate,
  resumeGenerationJob,
};

