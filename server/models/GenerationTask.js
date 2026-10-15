const mongoose = require('mongoose');

// Long-running AI work must have a durable record.  The stream connection is
// merely one way to observe a task, not the source of truth for its state.
const generationTaskSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  kind: {
    type: String,
    enum: ['novel_generation', 'screenplay_develop', 'screenplay_episode', 'screenplay_batch', 'editorial', 'optimize', 'semantic_review'],
    required: true,
    index: true,
  },
  resourceType: { type: String, enum: ['novel', 'screenplay'], required: true },
  resourceId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  status: { type: String, enum: ['queued', 'running', 'paused', 'completed', 'failed', 'cancelled'], default: 'queued', index: true },
  stage: { type: String, default: 'queued' },
  progress: { type: String, default: '' },
  currentUnit: { type: Number, default: 0 },
  totalUnits: { type: Number, default: 0 },
  retryCount: { type: Number, default: 0 },
  // Durable worker lease/checkpoint fields. A process restart can safely
  // release an expired lease and another worker can continue from checkpoint.
  workerId: { type: String, default: '', index: true },
  leaseExpiresAt: { type: Date, default: null, index: true },
  attempts: { type: Number, default: 0 },
  nextRunAt: { type: Date, default: null, index: true },
  checkpoint: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  cancellationRequested: { type: Boolean, default: false },
  idempotencyKey: { type: String, required: true, unique: true },
  activeKey: { type: String, default: undefined },
  error: { type: String, default: '' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  startedAt: { type: Date },
  completedAt: { type: Date },
  lastHeartbeatAt: { type: Date },
}, { timestamps: true });

generationTaskSchema.index({ userId: 1, resourceId: 1, status: 1, updatedAt: -1 });
generationTaskSchema.index({ activeKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('GenerationTask', generationTaskSchema);
