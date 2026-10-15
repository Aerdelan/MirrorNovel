const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'isolated-creative-migration-test-secret';
const dbName = `mn_creative_migration_test_${Date.now()}`;
const User = require('../models/User');
const Novel = require('../models/Novel');
const Screenplay = require('../models/Screenplay');
const ReferenceNovel = require('../models/ReferenceNovel');
const GenerationJob = require('../models/GenerationJob');
const GenerationTask = require('../models/GenerationTask');
const ai = require('../services/aiService');
const calls = [];
const scenes = Array.from({ length: 4 }, (_, i) => ({ sceneNumber: i + 1, heading: '场景', location: '旧城', characters: ['林舟'], action: '林舟推开门，检查现场并留下线索。'.repeat(40), objective: '追查', obstacle: '锁门', result: '找到线索', shotPlan: '近景', soundDesign: '敲门声', dialogue: Array.from({ length: 6 }, () => ({ character: '林舟', line: '线索在这里。', delivery: '低声', physicalAction: '指向桌面', position: '门边', subtext: '担心' })) }));
ai.streamGenerate = async (system, prompt, onChunk, _signal, config) => {
  calls.push({ system, prompt, model: config?.model, key: config?.apiKey });
  let content;
  if (system.includes('分析专家') || system.includes('资深的小说编辑')) content = '【风格描述】\n克制叙述，使用短句，通过对白中的隐含目的推进人物关系，场景保持具体。\n【精选片段】\n【片段1】\n门外响起脚步声。\n【写作特点】\n动作推动悬念\n【特色词汇】\n门、脚步\n【章节结构】\n冲突、转折、后果\n【质量评分】\n88';
  else if (prompt.includes('生成 name、description')) content = JSON.stringify({ name: '参考风格', voice: '近距离视角', tone: '短句', rules: '动作推动剧情', vocab: '具体词', axes: { temperature: 2 } });
  else if (system.includes('结构分析师')) content = '【整体结构】困境、选择、代价\n【阶段与章节节奏】渐进悬念';
  else if (system.includes('连续性审读员')) content = JSON.stringify({ verdicts: [{ chapterNumber: 1, verdict: 'executed', evidence: '已发现信件' }] });
  else if (prompt.includes('完整写出第') || system.includes('编剧') && prompt.includes('scenes')) content = JSON.stringify({ scenes });
  else content = JSON.stringify({ bible: { logline: '旧城来信引出失踪案', genre: '悬疑', visualTone: '冷色', characters: [{ name: '林舟', visual: '短发' }], locations: [{ name: '旧城', visual: '巷道' }] }, episodes: [1, 2].map(n => ({ episodeNumber: n, title: `线索${n}`, durationSeconds: 30, premise: '收到信', conflict: '线索被藏', turn: '发现钥匙', cliffhanger: '谁留下钥匙', scenePlan: scenes.map(s => ({ ...s, dialogue: undefined })) })) });
  if (onChunk) onChunk(content);
  return { content, usage: { prompt_tokens: 100, completion_tokens: 200 }, inputTokens: 100, tokenCount: 200 };
};
let server, base, users, headers;
async function waitUntil(check, timeout = 10000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 30)); } throw new Error('Timed out waiting for background test task'); }
async function request(path, { method = 'GET', body, user = 0 } = {}) {
  const response = await fetch(base + path, { method, headers: headers[user], ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { response, data };
}
test.before(async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27017/${dbName}`, { serverSelectionTimeoutMS: 3000 });
  await Promise.all([GenerationJob.init(), ReferenceNovel.init(), GenerationTask.init()]);
  users = await User.create([0, 1].map(n => ({ email: `creative-test-${n}@example.test`, nickname: `测试${n}`, password: 'test-password-only' })));
  const { encodeOverrideHeader } = require('../services/localModelConfig');
  headers = users.map((user, i) => ({ Authorization: `Bearer ${jwt.sign({ userId: String(user._id) }, process.env.JWT_SECRET)}`, 'Content-Type': 'application/json', 'x-mn-model-config': encodeOverrideHeader({ baseUrl: 'https://mock-provider.example.test/v1', apiKey: 'mock-key-' + i, models: { writing: 'mock-writing-' + i, outline: 'mock-outline-' + i, reasoning: 'mock-reasoning-' + i } }) }));
  const app = express(); app.use(express.json({ limit: '50mb' })); app.use('/api/reference', require('../routes/referenceFanqie')); app.use('/api/reference', require('../routes/reference')); app.use('/api/persona', require('../routes/persona')); app.use('/api/screenplay', require('../routes/screenplay')); app.use('/api/novel', require('../routes/novel'));
  app.use('/api/admin', require('../routes/admin'));
  app.use((error, _req, res, _next) => res.status(500).json({ message: error.message }));
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  process.env.PORT = String(server.address().port); base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (mongoose.connection.name === dbName && dbName.startsWith('mn_creative_migration_test_')) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
test('reference upload, background distillation, structure analysis and persona extraction stay account scoped', async () => {
  assert.equal((await request('/api/reference/fanqie-cookie-status')).response.status, 403);
  const uploaded = await request('/api/reference/upload', { method: 'POST', body: { title: '测试参考', mainCategory: '悬疑', content: '门外响起脚步声，林舟停下脚步。'.repeat(40) } });
  assert.equal(uploaded.response.status, 202);
  const id = uploaded.data.novel._id;
  assert.equal(uploaded.data.novel.content, undefined);
  await waitUntil(async () => (await ReferenceNovel.findById(id))?.status === 'ready');
  assert.equal((await request(`/api/reference/${id}`, { user: 1 })).response.status, 404);
  assert.deepEqual((await request('/api/reference/list-by-type', { user: 1 })).data, []);
  assert.equal((await request(`/api/reference/${id}/distill`, { user: 1, method: 'POST', body: {} })).response.status, 404);
  const structure = await request('/api/reference/analyze-structure', { method: 'POST', body: { referenceId: id } });
  assert.equal(structure.response.status, 200); assert.match(structure.data.analysis, /整体结构/);
  const persona = await request(`/api/persona/from-reference/${id}`, { method: 'POST', body: { scope: 'screenplay' } });
  assert.equal(persona.response.status, 200); assert.equal(persona.data.scope, 'screenplay'); assert.equal(persona.data.source, 'reference-extracted');
  assert.equal((await request('/api/reference/upload', { method: 'POST', body: { title: '测试参考', mainCategory: '悬疑', content: '测试正文'.repeat(100) } })).response.status, 409);
  assert.equal(calls.filter(c => c.system.includes('分析专家'))[0].model, 'mock-reasoning-0');
  const { prepareReferenceContext, buildReferencePrompt } = require('../services/referenceContext');
  const snapshot = await prepareReferenceContext(users[0]._id, { referenceIds: [id], structurePattern: structure.data.analysis });
  assert.match(buildReferencePrompt(snapshot), /写作人格优先/);
  await assert.rejects(prepareReferenceContext(users[1]._id, { referenceIds: [id] }), /不属于当前账号/);
  assert.equal(JSON.stringify(await ReferenceNovel.findById(id).select('+content')).includes('mock-key'), false);
});
test('novel adaptation, staged screenplay development, episode generation, export and batch worker use existing model routes', async () => {
  const novel = await Novel.create({ userId: users[0]._id, title: '用于改编的作品', novelTypeId: 'test', novelTypeName: '悬疑', status: 'paused', outline: '失踪案', chapterSummaryDoc: '收到一封信' });
  assert.equal((await request('/api/screenplay/projects', { user: 1, method: 'POST', body: { title: '非法改编', sourceType: 'adaptation', productionTarget: 'video', sourceNovelId: String(novel._id) } })).response.status, 404);
  const created = await request('/api/screenplay/projects', { method: 'POST', body: { title: '剧本测试', sourceType: 'adaptation', productionTarget: 'video', sourceNovelId: String(novel._id), episodeCount: 2, episodeDurationSeconds: 30 } });
  assert.equal(created.response.status, 201); const id = created.data._id;
  assert.equal((await request(`/api/screenplay/projects/${id}`, { user: 1 })).response.status, 404);
  const developed = await request(`/api/screenplay/projects/${id}/develop-stream`, { method: 'POST', body: {} });
  assert.equal(developed.response.status, 200); assert.match(developed.data, /"type":"completed"/);
  assert.equal((await Screenplay.findById(id)).episodes.length, 2);
  const generated = await request(`/api/screenplay/projects/${id}/episodes/1/generate`, { method: 'POST', body: {} });
  assert.equal(generated.response.status, 200, JSON.stringify(generated.data)); assert.equal(generated.data.episode.scenes.length, 4);
  const exported = await request(`/api/screenplay/projects/${id}/export`, { method: 'POST', body: { format: 'txt' } });
  assert.equal(exported.response.status, 200); assert.match(exported.data, /第1集/);
  const batch = await request(`/api/screenplay/projects/${id}/batch/start`, { method: 'POST', body: { episodeNumbers: [2] } });
  assert.equal(batch.response.status, 202, JSON.stringify(batch.data));
  await waitUntil(async () => (await GenerationTask.findById(batch.data.task._id))?.status === 'completed');
  assert.equal((await Screenplay.findById(id)).episodes[1].scenes.length, 4);
  assert.ok(calls.some(c => c.model === 'mock-writing-0'));
  assert.ok(calls.some(c => c.model === 'mock-outline-0'));
  assert.equal(calls.some(c => c.key !== 'mock-key-0'), false, 'batch loopback must forward the user model override');
  assert.equal(JSON.stringify(await Screenplay.findById(id)).includes('mock-key'), false);
  const docx = await fetch(base + `/api/screenplay/projects/${id}/export`, { method: 'POST', headers: headers[0], body: JSON.stringify({ format: 'docx' }) });
  assert.equal(docx.status, 200);
  const zip = require('fflate').unzipSync(new Uint8Array(await docx.arrayBuffer()));
  assert.ok(zip['word/document.xml']);
});
test('chapter versions restore saved text and synchronize existing continuation context; plan review uses reasoning route', async () => {
  const original = '林舟发现了一封旧信，决定追查失踪者。'.repeat(12);
  const revised = '林舟检查新线索并决定前往旧城调查。'.repeat(12);
  const novel = await Novel.create({ userId: users[0]._id, title: '版本测试', novelTypeId: 'test', novelTypeName: '悬疑', status: 'paused', currentWordCount: original.length,
    currentChapterIndex: 1, chapters: [{ chapterNumber: 1, title: '第1章 旧信', content: original, wordCount: original.length }], chapterPlanData: { chapters: [{ chapterNumber: 1, coreEvent: '发现信件' }] } });
  const id = String(novel._id);
  assert.equal((await request(`/api/novel/${id}/chapter/1`, { method: 'PUT', body: { content: revised } })).response.status, 200);
  const versions = (await request(`/api/novel/${id}/chapter/1/versions`)).data.versions;
  assert.equal(versions.length, 1);
  assert.equal((await request(`/api/novel/${id}/chapter/1/versions/${versions[0].version}/restore`, { user: 1, method: 'POST', body: {} })).response.status, 404);
  assert.equal((await request(`/api/novel/${id}/chapter/1/versions/${versions[0].version}/restore`, { method: 'POST', body: {} })).response.status, 200);
  const restored = await Novel.findById(id);
  assert.equal(restored.chapters[0].content, original); assert.equal(restored.currentWordCount, original.length);
  assert.ok(restored.chapterSummaryDoc);
  assert.equal((await request(`/api/novel/${id}/chapter/1/versions`)).data.versions.length, 2, 'current text is archived before restoring');
  const review = await request(`/api/novel/${id}/plan-drift-review`, { method: 'POST', body: {} });
  assert.equal(review.response.status, 200); assert.equal(review.data.verdicts[0].verdict, 'executed');
  assert.equal(calls.at(-1).model, 'mock-reasoning-0');
});

test('creative leases and active task keys reject concurrent writers and release after pause', async () => {
  const { runCreativeLease, isCreativeBusy } = require('../services/creativeLease');
  const { beginTask, pauseTask } = require('../services/generationTaskService');
  const id = new mongoose.Types.ObjectId(), key = `screenplay:${id}:development`;
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const work = runCreativeLease({ userId: users[0]._id, key, kind: 'screenplay_develop' }, async () => { started(); await gate; });
  await ready;
  try {
    assert.equal(await isCreativeBusy(key), true);
    await assert.rejects(runCreativeLease({ userId: users[0]._id, key, kind: 'screenplay_develop' }, async () => {}), { code: 'GENERATION_LEASE_BUSY' });
  } finally { release(); await work; }
  assert.equal(await isCreativeBusy(key), false);
  const input = { userId: users[0]._id, resourceId: id, resourceType: 'screenplay', kind: 'screenplay_batch' };
  const tasks = await Promise.allSettled([beginTask({ ...input, idempotencyKey: `batch-a:${id}` }), beginTask({ ...input, idempotencyKey: `batch-b:${id}` })]);
  assert.equal(tasks.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(tasks.find(result => result.status === 'rejected').reason.code, 11000);
  await pauseTask(tasks.find(result => result.status === 'fulfilled').value._id);
  const next = await beginTask({ ...input, idempotencyKey: `batch-c:${id}` });
  assert.equal(next.status, 'running'); await pauseTask(next._id);
});

test('image credentials stay encrypted and only administrators can change creative configuration', async () => {
  const SysConfig = require('../models/SysConfig');
  const { isSealed } = require('../services/secretBox');
  const { chooseImageModel } = require('../services/imageService');
  assert.equal((await request('/api/admin/image-generation')).response.status, 403);
  await User.updateOne({ _id: users[1]._id }, { $set: { role: 'admin' } });
  const config = { models: [{ id: 'image_1', baseUrl: 'https://image.example.test/v1', model: 'mock-image', apiKey: 'fake-image-secret' }] };
  const saved = await request('/api/admin/image-generation', { method: 'PUT', user: 1, body: config });
  assert.equal(saved.response.status, 200);
  assert.equal(JSON.stringify(saved.data).includes('fake-image-secret'), false);
  const stored = (await SysConfig.findOne({ key: 'image_generation' })).value;
  assert.equal(isSealed(stored.models[0].apiKey), true);
  assert.equal(chooseImageModel(stored, 'image_1').apiKey, 'fake-image-secret');
  const retained = await request('/api/admin/image-generation', { method: 'PUT', user: 1, body: { models: [{ ...config.models[0], apiKey: '' }] } });
  assert.equal(retained.response.status, 200);
  assert.equal(chooseImageModel((await SysConfig.findOne({ key: 'image_generation' })).value, 'image_1').apiKey, 'fake-image-secret');
  await User.updateOne({ _id: users[1]._id }, { $set: { role: 'user' } });
});

test('background images append atomically without overwriting concurrent episode saves', async () => {
  const { appendImageAsset, persistImageState } = require('../routes/screenplay');
  const doc = await Screenplay.create({ userId: users[0]._id, title: '并发生图测试', sourceType: 'original', productionTarget: 'video', episodes: [{ episodeNumber: 1, title: '旧标题' }] });
  const copies = await Promise.all([Screenplay.findById(doc._id), Screenplay.findById(doc._id)]);
  await Screenplay.updateOne({ _id: doc._id }, { $set: { 'episodes.0.title': '已保存的新标题' } });
  await Promise.all(copies.map((project, index) => appendImageAsset(project, { label: `画面${index}`, status: 'completed', urls: [`https://image.example.test/${index}.png`] })));
  copies[0].imageGeneration.status = 'completed'; await persistImageState(copies[0]);
  const saved = await Screenplay.findById(doc._id);
  assert.equal(saved.imageGeneration.assets.length, 2);
  assert.equal(saved.episodes[0].title, '已保存的新标题');
});
