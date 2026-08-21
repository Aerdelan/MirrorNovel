const mongoose = require('mongoose');

const sceneSchema = new mongoose.Schema({
  sceneNumber: { type: Number, required: true },
  heading: { type: String, default: '' },
  interiorExterior: { type: String, enum: ['INT', 'EXT', 'INT_EXT'], default: 'INT' },
  timeOfDay: { type: String, default: '' },
  location: { type: String, default: '' },
  characters: { type: [String], default: [] },
  action: { type: String, default: '' },
  dialogue: [{ character: { type: String, default: '' }, line: { type: String, default: '' } }],
  productionNotes: { type: String, default: '' },
}, { _id: false });

const episodeSchema = new mongoose.Schema({
  episodeNumber: { type: Number, required: true },
  title: { type: String, default: '' },
  durationSeconds: { type: Number, default: 120 },
  premise: { type: String, default: '' },
  conflict: { type: String, default: '' },
  turn: { type: String, default: '' },
  cliffhanger: { type: String, default: '' },
  scenes: { type: [sceneSchema], default: [] },
  generatedAt: { type: Date },
}, { _id: false });

const screenplaySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  sourceType: { type: String, enum: ['adaptation', 'original'], required: true },
  productionTarget: { type: String, enum: ['video', 'live_action'], required: true },
  sourceNovelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Novel', default: null },
  sourceSnapshot: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  concept: { type: String, default: '', maxlength: 5000 },
  episodeCount: { type: Number, min: 1, max: 120, default: 12 },
  episodeDurationSeconds: { type: Number, min: 30, max: 1800, default: 120 },
  screenplayBible: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  episodes: { type: [episodeSchema], default: [] },
  status: { type: String, enum: ['draft', 'developed'], default: 'draft' },
}, { timestamps: true });

module.exports = mongoose.model('Screenplay', screenplaySchema);
