const mongoose = require('mongoose');

const GENERATION_JOB_STATUSES = Object.freeze([
  'queued',
  'running',
  'pause_requested',
  'paused',
  'completed',
  'failed',
  'cancelled',
]);

const generationEventSchema = new mongoose.Schema({
  seq: { type: Number, required: true, min: 1 },
  type: { type: String, required: true },
  // Events intentionally contain only small status/progress metadata. Draft
  // prose lives in `draft`, never in the reconnect event ring buffer.
  payload: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  createdAt: { type: Date, default: Date.now },
}, { _id: false, minimize: false });

/**
 * A durable generation task.
 *
 * `leaseKey` is deliberately present only while a worker owns the task.  Its
 * sparse unique index turns a novel id into a database-enforced mutex: even if
 * two application processes race, only one of them can hold the lease for a
 * novel.  `fencingToken` is incremented whenever ownership changes so a slow,
 * previously timed-out worker can no longer checkpoint or finalize the job.
 */
const generationJobSchema = new mongoose.Schema({
  jobId: { type: String, required: true, unique: true, immutable: true },
  idempotencyKey: { type: String, required: true, unique: true, immutable: true },
  novelId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Novel',
    required: true,
    immutable: true,
    index: true,
  },
  kind: { type: String, required: true, immutable: true },
  status: {
    type: String,
    enum: GENERATION_JOB_STATUSES,
    default: 'queued',
    required: true,
    index: true,
  },
  chapterNumber: { type: Number, default: 0, min: 0 },
  phase: { type: String, default: 'queued' },
  // `phase` is the current UI/control-plane phase and may change when a lease
  // is reacquired. `draftPhase` records how far the durable chapter itself got
  // and is never overwritten by lease lifecycle changes. Reacquiring a paused
  // lease therefore cannot turn a complete draft back into a writing draft.
  draftPhase: { type: String, default: 'queued' },
  draft: { type: String, default: '' },
  draftSeq: { type: Number, default: 0, min: 0 },
  // Used to make a retried append/replace checkpoint idempotent.
  draftCheckpointHash: { type: String, default: '' },
  lastCommittedChapter: { type: Number, default: 0, min: 0 },

  // Present only for an actively leased job. See the unique sparse index below.
  leaseKey: { type: String, default: undefined },
  leaseOwner: { type: String, default: undefined },
  leaseUntil: { type: Date, default: undefined },
  fencingToken: { type: Number, default: 0, min: 0 },
  heartbeat: { type: Date, default: null },

  error: { type: mongoose.Schema.Types.Mixed, default: null },
  tokenUsage: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({
      promptTokens: 0,
      completionTokens: 0,
      reasoningTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
      calls: 0,
      failedCalls: 0,
      discardedTokens: 0,
    }),
  },
  eventSeq: { type: Number, default: 0, min: 0 },
  events: { type: [generationEventSchema], default: () => [] },
  metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  attempt: { type: Number, default: 0, min: 0 },
  acquiredAt: { type: Date, default: null },
  pauseRequestedAt: { type: Date, default: null },
  releasedAt: { type: Date, default: null },
  finishedAt: { type: Date, default: null },
}, {
  timestamps: true,
  minimize: false,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

generationJobSchema.virtual('pauseRequested').get(function pauseRequested() {
  return this.status === 'pause_requested';
});

generationJobSchema.index(
  { leaseKey: 1 },
  { unique: true, sparse: true, name: 'uniq_generation_job_active_novel_lease' },
);
generationJobSchema.index({ novelId: 1, createdAt: -1 });
generationJobSchema.index({ status: 1, leaseUntil: 1 });

const GenerationJob = mongoose.models.GenerationJob
  || mongoose.model('GenerationJob', generationJobSchema);

GenerationJob.GENERATION_JOB_STATUSES = GENERATION_JOB_STATUSES;

module.exports = GenerationJob;

