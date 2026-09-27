const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LeaseBusyError,
  StaleLeaseError,
  createGenerationJob,
  acquireGenerationJob,
  heartbeatGenerationJob,
  requestPauseGenerationJob,
  checkpointGenerationJob,
  appendGenerationDraft,
  finalizeGenerationJob,
  releaseGenerationJob,
  recoverExpiredJobs,
  findLatestResumableJob,
  resumeGenerationJob,
  appendGenerationEvent,
  readGenerationEvents,
} = require('../services/generationJob');

function valueAt(object, path) {
  return path.split('.').reduce((value, key) => value?.[key], object);
}

function setAt(object, path, value) {
  const parts = path.split('.');
  let target = object;
  while (parts.length > 1) {
    const part = parts.shift();
    if (!target[part] || typeof target[part] !== 'object') target[part] = {};
    target = target[part];
  }
  target[parts[0]] = value;
}

function unsetAt(object, path) {
  const parts = path.split('.');
  let target = object;
  while (parts.length > 1) target = target?.[parts.shift()];
  if (target) delete target[parts[0]];
}

function scalar(value) {
  if (value instanceof Date) return value.getTime();
  return value;
}

function matches(document, filter) {
  return Object.entries(filter || {}).every(([key, expected]) => {
    if (key === '$or') return expected.some((part) => matches(document, part));
    if (key === '$and') return expected.every((part) => matches(document, part));
    const actual = valueAt(document, key);
    if (expected && typeof expected === 'object' && !(expected instanceof Date) && !Array.isArray(expected)) {
      const operators = Object.keys(expected).filter((operator) => operator.startsWith('$'));
      if (operators.length) {
        return operators.every((operator) => {
          const operand = expected[operator];
          if (operator === '$exists') return operand ? actual !== undefined : actual === undefined;
          if (operator === '$in') return operand.some((item) => scalar(item) === scalar(actual));
          if (operator === '$lt') return scalar(actual) < scalar(operand);
          if (operator === '$lte') return scalar(actual) <= scalar(operand);
          if (operator === '$gt') return scalar(actual) > scalar(operand);
          if (operator === '$gte') return scalar(actual) >= scalar(operand);
          throw new Error(`Unsupported fake query operator: ${operator}`);
        });
      }
    }
    return scalar(actual) === scalar(expected);
  });
}

function evaluate(document, expression) {
  if (typeof expression === 'string' && expression.startsWith('$')) return valueAt(document, expression.slice(1));
  if (!expression || typeof expression !== 'object' || expression instanceof Date) return expression;
  if (Array.isArray(expression)) return expression.map((item) => evaluate(document, item));
  if ('$ifNull' in expression) {
    const values = evaluate(document, expression.$ifNull);
    return values[0] == null ? values[1] : values[0];
  }
  if ('$concat' in expression) return evaluate(document, expression.$concat).join('');
  if ('$concatArrays' in expression) return evaluate(document, expression.$concatArrays).flat();
  if ('$slice' in expression) {
    const [items, count] = evaluate(document, expression.$slice);
    return count < 0 ? items.slice(count) : items.slice(0, count);
  }
  if ('$max' in expression) return Math.max(...evaluate(document, expression.$max));
  if ('$add' in expression) return evaluate(document, expression.$add).reduce((sum, item) => sum + Number(item || 0), 0);
  return Object.fromEntries(Object.entries(expression).map(([key, value]) => [key, evaluate(document, value)]));
}

function sortDocs(documents, spec) {
  if (!spec) return documents;
  const entries = Object.entries(spec);
  return documents.sort((left, right) => {
    for (const [path, direction] of entries) {
      const a = scalar(valueAt(left, path)) ?? 0;
      const b = scalar(valueAt(right, path)) ?? 0;
      if (a < b) return -1 * direction;
      if (a > b) return 1 * direction;
    }
    return 0;
  });
}

class FakeQuery {
  constructor(executor) {
    this.executor = executor;
    this.sortSpec = null;
  }

  sort(spec) {
    this.sortSpec = spec;
    return this;
  }

  exec() {
    return Promise.resolve(this.executor(this.sortSpec));
  }

  then(resolve, reject) {
    return this.exec().then(resolve, reject);
  }
}

class FakeGenerationJobModel {
  static reset() {
    this.docs = [];
  }

  static ensureUnique(document, current = null) {
    const conflict = this.docs.find((candidate) => candidate !== current && (
      candidate.jobId === document.jobId
      || candidate.idempotencyKey === document.idempotencyKey
      || (document.leaseKey !== undefined && candidate.leaseKey === document.leaseKey)
    ));
    if (conflict) {
      const error = new Error('E11000 duplicate key');
      error.code = 11000;
      throw error;
    }
  }

  static applyUpdate(document, update, inserting = false) {
    if (Array.isArray(update)) {
      for (const stage of update) {
        const before = { ...document, tokenUsage: { ...(document.tokenUsage || {}) } };
        for (const [path, expression] of Object.entries(stage.$set || {})) {
          setAt(document, path, evaluate(before, expression));
        }
      }
      return;
    }
    if (inserting) {
      for (const [path, value] of Object.entries(update.$setOnInsert || {})) setAt(document, path, value);
    }
    for (const [path, value] of Object.entries(update.$set || {})) setAt(document, path, value);
    for (const path of Object.keys(update.$unset || {})) unsetAt(document, path);
    for (const [path, value] of Object.entries(update.$inc || {})) {
      setAt(document, path, Number(valueAt(document, path) || 0) + Number(value));
    }
    for (const [path, value] of Object.entries(update.$max || {})) {
      setAt(document, path, Math.max(Number(valueAt(document, path) || 0), Number(value)));
    }
  }

  static async findOneAndUpdate(filter, update, options = {}) {
    const candidates = sortDocs(this.docs.filter((document) => matches(document, filter)), options.sort);
    let document = candidates[0] || null;
    if (!document && options.upsert) {
      document = {};
      for (const [key, value] of Object.entries(filter)) {
        if (!key.startsWith('$') && (typeof value !== 'object' || value instanceof Date)) document[key] = value;
      }
      this.applyUpdate(document, update, true);
      this.ensureUnique(document);
      this.docs.push(document);
      return document;
    }
    if (!document) return null;
    const snapshot = structuredClone(document);
    this.applyUpdate(document, update);
    try {
      this.ensureUnique(document, document);
    } catch (error) {
      Object.keys(document).forEach((key) => delete document[key]);
      Object.assign(document, snapshot);
      throw error;
    }
    return document;
  }

  static findOne(filter) {
    return new FakeQuery((sortSpec) => sortDocs(this.docs.filter((document) => matches(document, filter)), sortSpec)[0] || null);
  }

  static async updateMany(filter, update) {
    const documents = this.docs.filter((document) => matches(document, filter));
    for (const document of documents) this.applyUpdate(document, update);
    return { modifiedCount: documents.length };
  }
}

FakeGenerationJobModel.reset();

const baseOptions = (now) => ({ GenerationJobModel: FakeGenerationJobModel, now });

test.beforeEach(() => FakeGenerationJobModel.reset());

test('same idempotency key returns the existing job without resetting it', async () => {
  const now = new Date('2026-09-26T00:00:00.000Z');
  const first = await createGenerationJob({
    novelId: 'novel-1', idempotencyKey: 'continue:1', kind: 'continue', chapterNumber: 4,
  }, { ...baseOptions(now), jobIdFactory: () => 'job-1' });
  first.draft = 'already written';
  const second = await createGenerationJob({
    novelId: 'novel-1', idempotencyKey: 'continue:1', kind: 'continue', chapterNumber: 99,
  }, { ...baseOptions(now), jobIdFactory: () => 'job-2' });

  assert.equal(first, second);
  assert.equal(second.jobId, 'job-1');
  assert.equal(second.chapterNumber, 4);
  assert.equal(second.draft, 'already written');
  assert.equal(FakeGenerationJobModel.docs.length, 1);
});

test('database lease is exclusive per novel and fenced finalize rejects an old worker', async () => {
  const now = new Date('2026-09-26T00:00:00.000Z');
  for (const [jobId, key] of [['job-1', 'key-1'], ['job-2', 'key-2']]) {
    await createGenerationJob({ novelId: 'novel-1', idempotencyKey: key, kind: 'continue', jobId }, baseOptions(now));
  }
  const owned = await acquireGenerationJob({
    jobId: 'job-1', novelId: 'novel-1', leaseOwner: 'worker-a', leaseMs: 10_000,
  }, baseOptions(now));
  assert.equal(owned.fencingToken, 1);
  const sameAcquire = await acquireGenerationJob({
    jobId: 'job-1', novelId: 'novel-1', leaseOwner: 'worker-a', leaseMs: 10_000,
  }, baseOptions(now));
  assert.equal(sameAcquire.fencingToken, 1, 'retrying acquire must not fence the current owner');

  await assert.rejects(
    () => acquireGenerationJob({
      jobId: 'job-2', novelId: 'novel-1', leaseOwner: 'worker-b', leaseMs: 10_000,
    }, baseOptions(now)),
    LeaseBusyError,
  );
  await assert.rejects(
    () => finalizeGenerationJob({ jobId: 'job-1', fencingToken: 0, status: 'completed' }, baseOptions(now)),
    StaleLeaseError,
  );

  const completed = await finalizeGenerationJob({
    jobId: 'job-1', fencingToken: 1, leaseOwner: 'worker-a', status: 'completed', lastCommittedChapter: 5,
  }, baseOptions(now));
  assert.equal(completed.status, 'completed');
  assert.equal(completed.leaseKey, undefined);

  const second = await acquireGenerationJob({
    jobId: 'job-2', novelId: 'novel-1', leaseOwner: 'worker-b', leaseMs: 10_000,
  }, baseOptions(now));
  assert.equal(second.status, 'running');
});

test('pause request is visible to heartbeat and checkpoint survives release', async () => {
  const now = new Date('2026-09-26T01:00:00.000Z');
  await createGenerationJob({
    novelId: 'novel-1', idempotencyKey: 'key-1', kind: 'continue', jobId: 'job-1',
  }, baseOptions(now));
  const owned = await acquireGenerationJob({
    jobId: 'job-1', novelId: 'novel-1', leaseOwner: 'worker-a', leaseMs: 10_000,
  }, baseOptions(now));
  await requestPauseGenerationJob({ jobId: 'job-1' }, baseOptions(now));

  const beat = await heartbeatGenerationJob({
    jobId: 'job-1', fencingToken: owned.fencingToken, leaseOwner: 'worker-a', leaseMs: 10_000,
  }, baseOptions(new Date(now.getTime() + 1000)));
  assert.equal(beat.pauseRequested, true);

  const checkpoint = await checkpointGenerationJob({
    jobId: 'job-1', fencingToken: owned.fencingToken, leaseOwner: 'worker-a',
    draftSeq: 1, draft: '半章草稿', chapterNumber: 6, phase: 'draft_complete',
    tokenUsageDelta: { completionTokens: 25, '$bad': 999 },
  }, baseOptions(new Date(now.getTime() + 2000)));
  assert.equal(checkpoint.draft, '半章草稿');
  assert.equal(checkpoint.draftPhase, 'draft_complete');
  assert.equal(checkpoint.tokenUsage.completionTokens, 25);
  assert.equal(checkpoint.tokenUsage.$bad, undefined);

  const paused = await releaseGenerationJob({
    jobId: 'job-1', fencingToken: owned.fencingToken, leaseOwner: 'worker-a', status: 'paused',
  }, baseOptions(new Date(now.getTime() + 3000)));
  assert.equal(paused.status, 'paused');
  assert.equal(paused.draft, '半章草稿');
  assert.equal(paused.draftSeq, 1);
  assert.equal(paused.phase, 'paused');
  assert.equal(paused.draftPhase, 'draft_complete', 'pausing must retain the exact durable draft stage');
});

test('replace and append checkpoints are monotonic and retry-safe', async () => {
  const now = new Date('2026-09-26T02:00:00.000Z');
  await createGenerationJob({
    novelId: 'novel-1', idempotencyKey: 'key-1', kind: 'continue', jobId: 'job-1',
  }, baseOptions(now));
  const owned = await acquireGenerationJob({
    jobId: 'job-1', novelId: 'novel-1', leaseOwner: 'worker-a', leaseMs: 10_000,
  }, baseOptions(now));
  const auth = { jobId: 'job-1', fencingToken: owned.fencingToken, leaseOwner: 'worker-a' };

  await checkpointGenerationJob({ ...auth, draftSeq: 1, draft: '第一段' }, baseOptions(now));
  const appended = await appendGenerationDraft({ ...auth, draftSeq: 2, chunk: '第二段' }, baseOptions(now));
  assert.equal(appended.draft, '第一段第二段');
  const retried = await appendGenerationDraft({ ...auth, draftSeq: 2, chunk: '第二段' }, baseOptions(now));
  assert.equal(retried.draft, '第一段第二段', 'same append sequence must not duplicate text');
  await assert.rejects(
    () => checkpointGenerationJob({ ...auth, draftSeq: 1, draft: 'different stale data' }, baseOptions(now)),
    StaleLeaseError,
  );
});

test('expired leases are recoverable and stale workers cannot write afterward', async () => {
  const started = new Date('2026-09-26T03:00:00.000Z');
  await createGenerationJob({
    novelId: 'novel-1', idempotencyKey: 'key-1', kind: 'continue', jobId: 'job-1',
  }, baseOptions(started));
  const oldLease = await acquireGenerationJob({
    jobId: 'job-1', novelId: 'novel-1', leaseOwner: 'worker-a', leaseMs: 1000,
  }, baseOptions(started));
  await checkpointGenerationJob({
    jobId: 'job-1', fencingToken: oldLease.fencingToken, leaseOwner: 'worker-a',
    leaseMs: 1000, draftSeq: 1, draft: '可恢复草稿', phase: 'draft_complete',
  }, baseOptions(started));

  const expiredAt = new Date(started.getTime() + 1001);
  assert.equal(await recoverExpiredJobs(baseOptions(expiredAt)), 1);
  const recoverable = await findLatestResumableJob('novel-1', 'continue', baseOptions(expiredAt));
  assert.equal(recoverable.status, 'queued');
  assert.equal(recoverable.draft, '可恢复草稿');
  assert.equal(recoverable.fencingToken, 2);
  await assert.rejects(
    () => heartbeatGenerationJob({
      jobId: 'job-1', fencingToken: oldLease.fencingToken, leaseOwner: 'worker-a', leaseMs: 1000,
    }, baseOptions(expiredAt)),
    StaleLeaseError,
  );

  const resumed = await resumeGenerationJob({
    novelId: 'novel-1', kind: 'continue', leaseOwner: 'worker-b', leaseMs: 5000,
  }, baseOptions(expiredAt));
  assert.equal(resumed.jobId, 'job-1');
  assert.equal(resumed.draft, '可恢复草稿');
  assert.equal(resumed.draftSeq, 1);
  assert.equal(resumed.fencingToken, 3);
  assert.equal(resumed.phase, 'resuming');
  assert.equal(resumed.draftPhase, 'draft_complete', 'lease recovery must not erase the durable draft stage');
});

test('resume creates and leases a new job when no durable draft exists', async () => {
  const now = new Date('2026-09-26T04:00:00.000Z');
  const resumed = await resumeGenerationJob({
    novelId: 'novel-1', kind: 'continue', leaseOwner: 'worker-a', leaseMs: 5000,
    idempotencyKey: 'resume-click-1', chapterNumber: 9,
  }, { ...baseOptions(now), jobIdFactory: () => 'new-job' });
  assert.equal(resumed.jobId, 'new-job');
  assert.equal(resumed.status, 'running');
  assert.equal(resumed.chapterNumber, 9);
  assert.equal(resumed.fencingToken, 1);
});

test('a cross-process lease loser is cancelled instead of becoming a future ghost resume', async () => {
  const now = new Date('2026-09-26T04:30:00.000Z');
  await createGenerationJob({
    novelId: 'novel-1', idempotencyKey: 'winner-key', kind: 'continue', jobId: 'winner-job',
  }, baseOptions(now));
  await acquireGenerationJob({
    jobId: 'winner-job', novelId: 'novel-1', leaseOwner: 'worker-a', leaseMs: 10_000,
  }, baseOptions(now));

  // Represents the second process having inserted its request just before the
  // first process won the unique per-novel lease.
  const loser = await createGenerationJob({
    novelId: 'novel-1', idempotencyKey: 'loser-key', kind: 'continue', jobId: 'loser-job',
  }, baseOptions(now));
  assert.equal(loser.status, 'queued');

  await assert.rejects(
    () => resumeGenerationJob({
      novelId: 'novel-1', kind: 'continue', leaseOwner: 'worker-b', leaseMs: 10_000,
    }, baseOptions(now)),
    LeaseBusyError,
  );

  assert.equal(loser.status, 'cancelled');
  assert.equal(loser.phase, 'superseded_duplicate');
  assert.equal(
    await findLatestResumableJob('novel-1', 'continue', baseOptions(now)),
    null,
    'the losing double click must never execute on a later resume',
  );
});

test('reconnect events are sequenced, bounded and never retain generated prose fields', async () => {
  const now = new Date('2026-09-26T05:00:00.000Z');
  await createGenerationJob({
    novelId: 'novel-1', idempotencyKey: 'key-1', kind: 'continue', jobId: 'job-1',
  }, baseOptions(now));
  for (let index = 1; index <= 205; index += 1) {
    await appendGenerationEvent({
      jobId: 'job-1',
      type: 'progress',
      payload: { chapter: index, percent: index / 205, content: `正文-${index}`, nested: { draft: 'secret' } },
    }, baseOptions(new Date(now.getTime() + index)));
  }

  const allRetained = await readGenerationEvents('job-1', 0, baseOptions(now));
  assert.equal(allRetained.length, 200);
  assert.equal(allRetained[0].seq, 6);
  assert.equal(allRetained.at(-1).seq, 205);
  assert.equal(allRetained.at(-1).payload.content, undefined);
  assert.equal(allRetained.at(-1).payload.nested.draft, undefined);

  const after = await readGenerationEvents('job-1', 202, baseOptions(now));
  assert.deepEqual(after.map((event) => event.seq), [203, 204, 205]);
});

