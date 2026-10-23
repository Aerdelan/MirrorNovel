const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const VerificationCode = require('../models/VerificationCode');
const { consumeCode } = require('../services/authValidation');

test('real User schema hashes a reset password and saves authVersion without exposing it in JSON', async () => {
  const connection = mongoose.createConnection();
  const Model = connection.model('AuthUserTest', User.schema.clone());
  const originalHash = await bcrypt.hash('old-secret', 4);
  const doc = Model.hydrate({ _id: new mongoose.Types.ObjectId(), email: 'reader@example.com', password: originalHash, authVersion: 0, inviteCode: 'test-invite' });
  let saved;
  Model.collection.updateOne = async (_filter, update) => { saved = update; return { matchedCount: 1 }; };
  try {
    doc.password = 'new-secret';
    doc.authVersion = 1;
    await doc.save();
    assert.equal(saved.$set.authVersion, 1);
    assert.notEqual(saved.$set.password, 'new-secret');
    assert.equal(await bcrypt.compare('new-secret', saved.$set.password), true);
    assert.equal(await bcrypt.compare('old-secret', saved.$set.password), false);
    assert.equal(doc.toJSON().password, undefined);
    assert.equal(doc.toJSON().authVersion, undefined);
  } finally { await connection.close(); }
});

test('real code schema preserves atomic attempt filters and sparse unique delivery slot index', async () => {
  const indexes = VerificationCode.schema.indexes();
  assert.ok(indexes.some(([key, options]) => key.deliveryKey === 1 && options.unique && options.sparse));
  const originalUpdate = VerificationCode.collection.findOneAndUpdate;
  const originalDelete = VerificationCode.collection.findOneAndDelete;
  const id = new mongoose.Types.ObjectId();
  let attemptFilter, attemptUpdate, deleteFilter;
  VerificationCode.collection.findOneAndUpdate = async (filter, update) => {
    attemptFilter = filter; attemptUpdate = update;
    return { _id: id, email: 'reader@example.com', type: 'reset', code: '123456', attempts: 1, expiresAt: new Date(Date.now() + 60000) };
  };
  VerificationCode.collection.findOneAndDelete = async filter => { deleteFilter = filter; return { _id: id }; };
  try {
    assert.equal(await consumeCode('reader@example.com', 'reset', '123456'), true);
    assert.equal(attemptFilter.type, 'reset');
    assert.deepEqual(attemptFilter.$or, [{ attempts: { $lt: 10 } }, { attempts: { $exists: false } }]);
    assert.deepEqual(attemptUpdate.$inc, { attempts: 1 });
    assert.ok(attemptFilter.expiresAt.$gt instanceof Date);
    assert.equal(String(deleteFilter._id), String(id));
    assert.equal(deleteFilter.code, '123456');
  } finally {
    VerificationCode.collection.findOneAndUpdate = originalUpdate;
    VerificationCode.collection.findOneAndDelete = originalDelete;
  }
});
