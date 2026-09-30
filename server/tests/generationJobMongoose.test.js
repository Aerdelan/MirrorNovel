const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const GenerationJob = require('../models/GenerationJob');
const { createGenerationJob } = require('../services/generationJob');

test('real Mongoose upsert has no timestamp path conflict and keeps retries unchanged', async () => {
  // Run the real query middleware, replacing only the driver operation. The
  // in-memory service adapter cannot catch middleware-added update operators.
  const connection = mongoose.createConnection();
  const Model = connection.model('GenerationJob', GenerationJob.schema.clone());
  let stored = null;
  const updates = [];
  Model.collection.findOneAndUpdate = async (_filter, update) => {
    updates.push(update);
    const seen = new Set();
    for (const fields of Object.values(update)) {
      for (const path of Object.keys(fields)) {
        assert.equal(seen.has(path), false, `Conflicting update path: ${path}`);
        seen.add(path);
      }
    }
    if (!stored) stored = JSON.parse(JSON.stringify({ _id: new mongoose.Types.ObjectId(), ...update.$setOnInsert }));
    if (update.$set) Object.assign(stored, update.$set);
    return JSON.parse(JSON.stringify(stored));
  };
  try {
    const input = { novelId: new mongoose.Types.ObjectId(), kind: 'novel', idempotencyKey: 'isolated-create' };
    const firstDate = new Date('2026-01-01T00:00:00Z');
    const first = await createGenerationJob(input, { GenerationJobModel: Model, now: firstDate });
    const retry = await createGenerationJob(input, { GenerationJobModel: Model, now: new Date('2026-01-02T00:00:00Z') });
    assert.equal(first.jobId, retry.jobId);
    assert.equal(retry.createdAt.getTime(), firstDate.getTime());
    assert.equal(retry.updatedAt.getTime(), firstDate.getTime());
    assert.equal(updates.length, 2);
    assert.ok(updates.every((update) => !update.$set));
  } finally {
    await connection.close();
  }
});
