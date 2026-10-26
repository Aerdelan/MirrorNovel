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
const WritingSample = require('../models/WritingSample');
const WritingStyleRevision = require('../models/WritingStyleRevision');
const WritingFeedback = require('../models/WritingFeedback');
const WritingPreference = require('../models/WritingPreference');
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
  await Promise.all([Novel.init(), GenerationJob.init(), ReferenceNovel.init(), GenerationTask.init(), WritingSample.init(), WritingStyleRevision.init(), WritingFeedback.init(), WritingPreference.init()]);
  users = await User.create([0, 1].map(n => ({ email: `creative-test-${n}@example.test`, nickname: `测试${n}`, password: 'test-password-only' })));
  const { encodeOverrideHeader } = require('../services/localModelConfig');
  headers = users.map((user, i) => ({ Authorization: `Bearer ${jwt.sign({ userId: String(user._id) }, process.env.JWT_SECRET)}`, 'Content-Type': 'application/json', 'x-mn-model-config': encodeOverrideHeader({ baseUrl: 'https://mock-provider.example.test/v1', apiKey: 'mock-key-' + i, models: { writing: 'mock-writing-' + i, outline: 'mock-outline-' + i, reasoning: 'mock-reasoning-' + i } }) }));
  const app = express(); app.use(express.json({ limit: '50mb' })); app.use('/api/reference', require('../routes/referenceFanqie')); app.use('/api/reference', require('../routes/reference')); app.use('/api/persona', require('../routes/persona')); app.use('/api/screenplay', require('../routes/screenplay')); app.use('/api/novel', require('../routes/novel'));
  app.use('/api/writing-samples', require('../routes/writingSamples'));
  app.use('/api/style-revisions', require('../routes/styleRevisions').router);
  app.use('/api/writing-feedback', require('../routes/writingFeedback'));
  app.use('/api/writing-preferences', require('../routes/writingPreferences'));
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
test('manual scene saves enforce ownership, optimistic versions and generation leases without changing other content or calling AI', async () => {
  const { sceneEditSnapshot } = require('../services/screenplaySceneEdit');
  const { runCreativeLease } = require('../services/creativeLease');
  const { beginTask, pauseTask } = require('../services/generationTaskService');
  const project = await Screenplay.create({ userId: users[0]._id, title: '手工场景测试', sourceType: 'original', productionTarget: 'live_action', episodeCount: 2,
    screenplayBible: { logline: '旧城调查', characters: [{ name: '林舟' }] },
    imageGeneration: { assets: [{ label: '保留图片', urls: ['https://example.test/image.png'] }] },
    episodes: [1, 2].map(n => ({ episodeNumber: n, title: `第${n}集`, durationSeconds: 30, scenes: [1, 2].map(s => ({ sceneNumber: s, location: '旧城', action: `原动作${n}-${s}`, imagePlan: { prompt: '原图提示' }, dialogue: [{ character: '林舟', line: `原台词${n}-${s}`, subtext: '原潜台词' }] })) })) });
  const id = String(project._id), url = `/api/screenplay/projects/${id}/episodes/1/scenes/1`;
  const original = project.episodes[0].scenes[0].toObject();
  const payload = { expectedScene: original, scene: { ...sceneEditSnapshot(original), action: '  她愣住了。\n', dialogue: [{ character: '林舟', line: '手工线索代号雪松', delivery: '低声', physicalAction: '指向信件', position: '门边', subtext: '保留潜台词' }] } };
  const callsBefore = calls.length;
  assert.equal((await request(url, { method: 'PUT', user: 1, body: payload })).response.status, 404);
  const saved = await request(url, { method: 'PUT', body: payload });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.scene.action, '  她愣住了。\n');
  assert.ok(saved.data.scene.editedAt);
  assert.equal(saved.data.scene.dialogue[0].subtext, '保留潜台词');
  assert.equal(calls.length, callsBefore, 'manual editing must never call a model');
  const after = await Screenplay.findById(id);
  assert.equal(after.episodes[0].scenes[1].action, '原动作1-2');
  assert.equal(after.episodes[1].scenes[0].action, '原动作2-1');
  assert.equal(after.episodes[0].scenes[0].imagePlan.prompt, '原图提示');
  assert.deepEqual(after.imageGeneration, project.imageGeneration);
  assert.equal((await request(url, { method: 'PUT', body: payload })).response.status, 409, 'stale editor must not overwrite newer text');
  assert.equal((await request(url, { method: 'PUT', body: { scene: payload.scene } })).response.status, 400);
  const next = { expectedScene: saved.data.scene, scene: { ...sceneEditSnapshot(saved.data.scene), action: '第二次修改' } };
  for (const unit of ['episode:1', 'development', 'batch']) {
    let release, started;
    const ready = new Promise(resolve => { started = resolve; }), gate = new Promise(resolve => { release = resolve; });
    const work = runCreativeLease({ userId: users[0]._id, key: `screenplay:${id}:${unit}`, kind: 'screenplay_episode' }, async () => { started(); await gate; });
    await ready;
    try { assert.equal((await request(url, { method: 'PUT', body: next })).response.status, 409, unit); }
    finally { release(); await work; }
  }
  const batch = await beginTask({ userId: users[0]._id, resourceId: project._id, resourceType: 'screenplay', kind: 'screenplay_batch' });
  try { assert.equal((await request(url, { method: 'PUT', body: next })).response.status, 409); }
  finally { await pauseTask(batch._id); }
  assert.equal((await Screenplay.findById(id)).episodes[0].scenes[0].action, '  她愣住了。\n');
  const exported = await request(`/api/screenplay/projects/${id}/export`, { method: 'POST', body: { format: 'txt' } });
  assert.match(exported.data, /手工线索代号雪松/);
  assert.equal((await request(`/api/screenplay/projects/${id}/episodes/2/generate`, { method: 'POST', body: {} })).response.status, 200);
  assert.ok(calls.slice(callsBefore).some(call => call.prompt.includes('手工线索代号雪松')), 'subsequent episodes must receive the saved scene in their continuity context');
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

test('writing sample library enforces explicit approval, account isolation, idempotent saves and hard limits', async () => {
  const { loadApprovedSamples, hashSampleContent } = require('../services/writingSamples');
  const text = n => `样稿正文${n}：窗外的雨没有停，他把那封信折好放回抽屉，关门时又停了一会儿，直到楼道的灯亮起来。`;
  const novel = await Novel.create({ userId: users[0]._id, title: '样稿来源作品', novelTypeId: 'test', novelTypeName: '测试', chapters: [1, 2].map(n => ({ chapterNumber: n, title: `第${n}章`, content: `第${n}章正文`, wordCount: 6 })) });
  const reference = await ReferenceNovel.create({ userId: users[0]._id, title: '样稿来源参考', aiProcessed: true, status: 'ready', keyExcerpts: ['参考片段原文：克制叙述并留白，动作先于情绪出现，对白里藏着未说出口的目的，结尾停在门把手上。'] });
  const created = await request('/api/writing-samples', { method: 'POST', body: { content: text(1), title: '雨夜动作', scope: 'novel', sceneType: 'action', sourceKind: 'own_text', sourceNovelId: String(novel._id), sourceChapterNumber: 1 } });
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  const sample = created.data.sample;
  assert.equal(sample.status, 'draft');
  assert.equal(sample.allowedForModelInput, false);
  assert.equal(sample.sourceNovelTitle, '样稿来源作品');
  assert.equal(sample.sourceChapterNumber, 1);
  const again = await request('/api/writing-samples', { method: 'POST', body: { content: text(1), title: '雨夜动作', sourceKind: 'own_text', sourceNovelId: String(novel._id), sourceChapterNumber: 1 } });
  assert.equal(again.response.status, 200);
  assert.equal(again.data.duplicate, true, 'repeated clicks must return the existing record');
  assert.equal(again.data.sample._id, sample._id);
  assert.equal(await WritingSample.countDocuments({ userId: users[0]._id }), 1);
  const list = await request('/api/writing-samples?limit=10');
  assert.equal(list.data.total, 1);
  assert.equal(list.data.statusCounts.draft, 1);
  assert.equal((await request('/api/writing-samples', { method: 'POST', body: { content: '太短', sourceKind: 'own_text' } })).response.status, 400);
  assert.equal((await request('/api/writing-samples', { method: 'POST', body: { content: 'x'.repeat(2001), sourceKind: 'own_text' } })).response.status, 400);
  assert.equal((await request('/api/writing-samples', { method: 'POST', body: { content: text(2), sourceNovelId: String(novel._id), sourceChapterNumber: 99 } })).response.status, 400);
  assert.equal((await request('/api/writing-samples', { method: 'POST', user: 1, body: { content: text(2), sourceNovelId: String(novel._id), sourceChapterNumber: 2 } })).response.status, 404, 'another account cannot cite this novel as a source');
  assert.equal((await request('/api/writing-samples', { method: 'POST', user: 1, body: { content: text(2), sourceKind: 'authorized_reference', sourceReferenceId: String(reference._id) } })).response.status, 404);
  assert.equal((await request(`/api/writing-samples/${sample._id}/approve`, { method: 'POST', user: 1, body: {} })).response.status, 404);
  const approved = await request(`/api/writing-samples/${sample._id}/approve`, { method: 'POST', body: {} });
  assert.equal(approved.response.status, 200);
  assert.equal(approved.data.sample.status, 'approved');
  assert.equal(approved.data.sample.allowedForModelInput, true);
  const poolOwner = await loadApprovedSamples(String(users[0]._id));
  assert.deepEqual(poolOwner.map(row => String(row._id)), [String(sample._id)]);
  assert.deepEqual(await loadApprovedSamples(String(users[1]._id)), [], 'the pool must never leak across accounts');
  await request(`/api/writing-samples/${sample._id}/revoke`, { method: 'POST', body: {} });
  assert.deepEqual(await loadApprovedSamples(String(users[0]._id)), [], 'revoked samples must leave the pool immediately');
  const archived = await request(`/api/writing-samples/${sample._id}/approve`, { method: 'POST', body: { allowedForModelInput: false } });
  assert.equal(archived.data.sample.status, 'approved');
  assert.equal(archived.data.sample.allowedForModelInput, false);
  assert.deepEqual(await loadApprovedSamples(String(users[0]._id)), [], 'approval without model-input consent stays out of the pool');
  const edited = await request(`/api/writing-samples/${sample._id}`, { method: 'PUT', body: { content: text(3) } });
  assert.equal(edited.response.status, 200);
  assert.equal(edited.data.sample.status, 'draft', 'editing approved content requires re-approval');
  assert.equal(edited.data.sample.allowedForModelInput, false);
  assert.notEqual(edited.data.sample.contentHash, sample.contentHash);
  const excerpt = await request('/api/writing-samples', { method: 'POST', body: { content: reference.keyExcerpts[0], sourceKind: 'authorized_reference', sourceReferenceId: String(reference._id), allowedForModelInput: true } });
  assert.equal(excerpt.response.status, 201);
  assert.equal(excerpt.data.sample.status, 'draft', 'reference excerpts must wait for explicit approval');
  assert.equal(excerpt.data.sample.allowedForModelInput, false);
  assert.equal(excerpt.data.sample.sourceReferenceTitle, '样稿来源参考');
  assert.equal((await request(`/api/writing-samples/${sample._id}`, { user: 1 })).response.status, 404);
  assert.equal((await request(`/api/writing-samples/${sample._id}`, { method: 'PUT', user: 1, body: { content: text(4) } })).response.status, 404);
  assert.equal((await request(`/api/writing-samples/${sample._id}/revoke`, { method: 'POST', user: 1, body: {} })).response.status, 404);
  assert.equal((await request(`/api/writing-samples/${sample._id}`, { method: 'DELETE', user: 1 })).response.status, 404);
  assert.equal((await request('/api/writing-samples/definitely-not-an-id', { method: 'DELETE' })).response.status, 404);
  const filler = await User.create({ email: 'sample-cap@example.test', nickname: '限额', password: 'test-password-only' });
  const fillerHeaders = { Authorization: `Bearer ${jwt.sign({ userId: String(filler._id) }, process.env.JWT_SECRET)}`, 'Content-Type': 'application/json' };
  const fillerRequest = (path, options = {}) => fetch(base + path, { method: options.method || 'GET', headers: fillerHeaders, ...(options.body ? { body: JSON.stringify(options.body) } : {}) }).then(async r => ({ response: r, data: await r.json().catch(() => null) }));
  const bulk = Array.from({ length: 200 }, (_, i) => ({ userId: filler._id, content: text(`bulk-${i}`) + `编号${i}。`, contentHash: hashSampleContent(text(`bulk-${i}`) + `编号${i}。`), status: 'draft' }));
  await WritingSample.insertMany(bulk);
  assert.equal((await fillerRequest('/api/writing-samples', { method: 'POST', body: { content: text('over') } })).response.status, 400, 'per-account sample count is capped');
  const dupAtCap = await fillerRequest('/api/writing-samples', { method: 'POST', body: { content: bulk[0].content } });
  assert.equal(dupAtCap.response.status, 200, 'duplicate detection must precede the count cap');
  assert.equal(dupAtCap.data.duplicate, true);
  await WritingSample.deleteMany({ userId: filler._id });
  assert.equal((await fillerRequest('/api/writing-samples', { method: 'POST', body: { content: text('over') } })).response.status, 201);
  const paged = await fillerRequest('/api/writing-samples?limit=1&page=2');
  assert.equal(paged.response.status, 200);
  assert.equal(paged.data.limit, 1);
  assert.equal(paged.data.page, 2);
  assert.equal(paged.data.total, 1);
  assert.equal((await request(`/api/writing-samples/${sample._id}`, { method: 'DELETE' })).response.status, 200);
  assert.equal(await WritingSample.countDocuments({ _id: sample._id }), 0);
  const foreignSample = excerpt.data.sample._id;
  assert.equal((await request(`/api/writing-samples/${foreignSample}`, { method: 'DELETE', user: 1 })).response.status, 404);
});

test('style revisions freeze at creation, adopt account-scoped, rotate per chapter and reject busy novels', async () => {
  const { resumeGenerationJob, finalizeGenerationJob } = require('../services/generationJob');
  const approvedText = n => `已认可样稿${n}：窗外的雨没有停，他把那封信折好放回抽屉，关门时又停了一会儿，直到楼道的灯亮起来。编号${n}。`;
  const revText = n => `新样稿${n}：门把手上的凉意先于敲门声到达，她数了三秒才把链条挂上，像是给离开留一个体面的期限。编号${n}。`;
  const s1 = await request('/api/writing-samples', { method: 'POST', body: { content: approvedText(1), title: '雨夜一', sourceKind: 'own_text' } });
  const s2 = await request('/api/writing-samples', { method: 'POST', body: { content: approvedText(2), title: '雨夜二', sourceKind: 'own_text' } });
  assert.equal(s1.response.status, 201);
  await request(`/api/writing-samples/${s2.data.sample._id}/approve`, { method: 'POST', body: {} });
  await request(`/api/writing-samples/${s1.data.sample._id}/approve`, { method: 'POST', body: {} });

  const v1 = await request('/api/style-revisions', { method: 'POST', body: { name: '雨夜初版', sampleIds: [s1.data.sample._id, s2.data.sample._id] } });
  assert.equal(v1.response.status, 201, JSON.stringify(v1.data));
  assert.equal(v1.data.revision.version, 1);
  assert.equal(v1.data.revision.samples.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(v1.data.revision.sampleBudget)), { maxCount: 3, maxCharsPerSample: 240 });
  assert.equal((await request('/api/style-revisions', { method: 'POST', user: 1, body: { sampleIds: [s1.data.sample._id] } })).response.status, 400, 'foreign account cannot pin samples it does not own');
  assert.equal((await request(`/api/style-revisions/${v1.data.revision._id}`, { user: 1 })).response.status, 404);
  const listed = await request('/api/style-revisions');
  assert.equal(listed.data.total, 1);
  assert.equal((await request(`/api/style-revisions/compare/${v1.data.revision._id}/${v1.data.revision._id}`)).response.status, 400);

  const novel = await Novel.create({ userId: users[0]._id, title: '版本采用之书', novelTypeId: 'test', novelTypeName: '测试', chapters: [{ chapterNumber: 1, title: '第一章', content: '开篇正文。'.repeat(20), wordCount: 100 }] });
  const adoptUrl = `/api/novel/${novel._id}/style-revision`;
  assert.equal((await request(adoptUrl, { method: 'PUT', user: 1, body: { revisionId: v1.data.revision._id } })).response.status, 404, 'another account cannot adopt this revision');
  const busy = await resumeGenerationJob({ novelId: novel._id, kind: 'novel', leaseOwner: 'rev-test-owner', leaseMs: 60000, metadata: { userId: String(users[0]._id) } });
  try {
    assert.equal((await request(adoptUrl, { method: 'PUT', body: { revisionId: v1.data.revision._id } })).response.status, 409, 'adoption must wait for the running task');
    assert.equal((await request(`/api/novel/${novel._id}/outline`, { method: 'PUT', body: { outline: '新大纲' } })).response.status, 409);
  } finally {
    await finalizeGenerationJob({ jobId: busy.jobId, leaseOwner: 'rev-test-owner', fencingToken: busy.fencingToken, status: 'completed' });
  }
  const adopted = await request(adoptUrl, { method: 'PUT', body: { revisionId: v1.data.revision._id } });
  assert.equal(adopted.response.status, 200, JSON.stringify(adopted.data));
  assert.equal(adopted.data.styleRevision.adoptedAtChapter, 2);
  const afterAdopt = await Novel.findById(novel._id);
  assert.equal(String(afterAdopt.styleRevisionId), String(v1.data.revision._id));
  assert.equal(afterAdopt.styleRevisionSnapshot.version, 1);
  assert.equal(afterAdopt.styleRevisionSnapshot.adoptedAtChapter, 2);
  assert.ok(afterAdopt.styleRevisionSnapshot.samples.every(row => row.content.length <= 240));

  // 版本固定：随后新增样稿并创建 v2，已采用作品的快照不得跟着变化。
  const s3 = await request('/api/writing-samples', { method: 'POST', body: { content: revText(1), title: '新凉', sourceKind: 'own_text' } });
  await request(`/api/writing-samples/${s3.data.sample._id}/approve`, { method: 'POST', body: {} });
  const v2 = await request('/api/style-revisions', { method: 'POST', body: { name: '加入门把手', sampleIds: [s1.data.sample._id, s2.data.sample._id, s3.data.sample._id] } });
  assert.equal(v2.response.status, 201);
  assert.equal(v2.data.revision.version, 2);
  const sameSnapshot = (await Novel.findById(novel._id)).styleRevisionSnapshot;
  assert.equal(sameSnapshot.version, 1, 'adopted snapshot must stay frozen while later revisions appear');
  assert.equal(sameSnapshot.samples.length, 2);
  const diff = await request(`/api/style-revisions/compare/${v1.data.revision._id}/${v2.data.revision._id}`);
  assert.equal(diff.response.status, 200);
  assert.deepEqual(diff.data.diff.samples.added.map(row => row.title), ['新凉']);
  assert.deepEqual(diff.data.diff.samples.removed, []);

  // 注入与记录：续写第 2 章时系统提示包含样稿块，章节记录抽样明细。
  const callsBefore = calls.length;
  const continued = await request(`/api/novel/${novel._id}/continue-chapter/2`, { method: 'POST', body: { wordCount: 100 } });
  assert.equal(continued.response.status, 200, JSON.stringify(continued.data).slice(0, 200));
  const writingCall = calls.slice(callsBefore).find(call => call.system.includes('续写专家') || call.system.includes('专业的小说家'));
  assert.ok(writingCall, 'a writing call must have been made');
  assert.match(writingCall.system, /【作者认可的写作样稿】/);
  assert.match(writingCall.system, /已认可样稿1|已认可样稿2/);
  assert.doesNotMatch(writingCall.system, /新凉/, 'samples added after adoption must not leak into the frozen snapshot');
  const withChapter = await Novel.findById(novel._id);
  const chapter2 = withChapter.chapters.find(c => c.chapterNumber === 2);
  assert.ok(chapter2, 'chapter 2 must be committed');
  assert.ok((chapter2.content || '').length > 100, 'continued chapter must persist its generated content (mongoose push-clone regression guard)');
  assert.equal(chapter2.styleSamples.version, 1);
  // 轮换语义：第 2 章从版本内第 2 段开始环绕取 min(3, 2)=2 段，顺序为 [s2, s1]。
  assert.deepEqual(chapter2.styleSamples.sampleIds, [String(s2.data.sample._id), String(s1.data.sample._id)], 'rotation record names the exact picked samples in rotated order');
  assert.match(chapter2.styleSamples.reasons[0], /第2章从第2段开始取2段（版本共2段）/);
  assert.ok(chapter2.styleSamples.reasons.length >= 1);

  // 停用：清空快照，回到旧路径。
  const cleared = await request(adoptUrl, { method: 'PUT', body: { revisionId: null } });
  assert.equal(cleared.response.status, 200);
  const bareNovel = await Novel.findById(novel._id);
  assert.equal(bareNovel.styleRevisionId, null);
  assert.equal(bareNovel.styleRevisionSnapshot, null);
});

test('writing feedback and preferences stay explicit, account scoped, fresh and never auto-apply', async () => {
  const revisedText = '门轴一声轻响，他先看了四周，才跨进门去，顺手把灯绳绕了半圈。';
  const originalText = '他推开门走了进去，然后又看了看四周，把灯打开了。';
  const novel0 = await Novel.create({ userId: users[0]._id, title: '反馈来源书', novelTypeId: 'test', novelTypeName: '测试', chapters: [{ chapterNumber: 1, title: '第一章', content: '开篇。' + revisedText + '结尾。', wordCount: 40 }] });
  const novel1 = await Novel.create({ userId: users[0]._id, title: '另一本书', novelTypeId: 'test', novelTypeName: '测试', chapters: [{ chapterNumber: 1, title: '第一章', content: '另一本书的开篇。', wordCount: 10 }] });

  // 记录：幂等、校验、跨账号
  const fb = await request('/api/writing-feedback', { method: 'POST', body: { novelId: String(novel0._id), sourceChapterNumber: 1, originalText, revisedText, reason: 'pacing', sceneType: 'action' } });
  assert.equal(fb.response.status, 201, JSON.stringify(fb.data));
  assert.equal(fb.data.duplicate, false);
  const fbAgain = await request('/api/writing-feedback', { method: 'POST', body: { novelId: String(novel0._id), sourceChapterNumber: 1, originalText, revisedText, reason: 'pacing' } });
  assert.equal(fbAgain.data.duplicate, true);
  assert.equal(fbAgain.data.feedback._id, fb.data.feedback._id);
  assert.equal((await WritingFeedback.countDocuments({ userId: users[0]._id })), 1);
  assert.equal((await request('/api/writing-feedback', { method: 'POST', body: { novelId: String(novel0._id), sourceChapterNumber: 1, originalText, revisedText, reason: 'generated' } })).response.status, 400);
  assert.equal((await request('/api/writing-feedback', { method: 'POST', body: { novelId: String(novel0._id), sourceChapterNumber: 1, originalText, revisedText: originalText, reason: 'pacing' } })).response.status, 400, 'identical texts are not an edit');
  assert.equal((await request('/api/writing-feedback', { method: 'POST', user: 1, body: { novelId: String(novel0._id), sourceChapterNumber: 1, originalText, revisedText, reason: 'pacing' } })).response.status, 404);
  const listed = await request('/api/writing-feedback');
  assert.equal(listed.data.total, 1);

  // 仅纠错：拒绝提炼，不产生任何调用
  const correction = await request('/api/writing-feedback', { method: 'POST', body: { novelId: String(novel0._id), sourceChapterNumber: 1, originalText: originalText + '，。', revisedText, reason: 'correction_only' } });
  const callsBeforeDistill = calls.length;
  const rejected = await request(`/api/writing-feedback/${correction.data.feedback._id}/distill`, { method: 'POST', body: {} });
  assert.equal(rejected.response.status, 400);
  assert.equal(calls.length, callsBeforeDistill, 'rejected distillation must not call a model');

  // 显式提炼：一次推理调用 → 候选（不生效）；重复提炼幂等且不再调用
  const originalStream = ai.streamGenerate;
  ai.streamGenerate = async (system, prompt) => {
    calls.push({ system, prompt });
    assert.match(system, /只输出一个 JSON 对象/);
    assert.match(prompt, /修改后（资料）/);
    return { content: JSON.stringify({ statement: '动作先于情绪出现，让读者从行为里读出紧张，而不是直接写出情绪词。', rationale: '保留留白' }), usage: { prompt_tokens: 10, completion_tokens: 5 } };
  };
  try {
    const distilled = await request(`/api/writing-feedback/${fb.data.feedback._id}/distill`, { method: 'POST', body: {} });
    assert.equal(distilled.response.status, 200, JSON.stringify(distilled.data));
    assert.equal(distilled.data.duplicate, false);
    assert.equal(distilled.data.preference.status, 'candidate', 'distilled candidates must not apply by themselves');
    assert.equal(distilled.data.preference.source, 'distilled');
    assert.equal(String(distilled.data.preference.novelId), String(novel0._id), 'distilled preference stays scoped to its book');
    assert.ok(distilled.data.preference.evidence.some(row => String(row.feedbackId) === String(fb.data.feedback._id)));
    const midCalls = calls.length;
    const again = await request(`/api/writing-feedback/${fb.data.feedback._id}/distill`, { method: 'POST', body: {} });
    assert.equal(again.data.duplicate, true);
    assert.equal(again.data.preference._id, distilled.data.preference._id);
    assert.equal(calls.length, midCalls, 're-distillation is idempotent without another model call');

    // 模型不可用：提炼失败但反馈保持可复用，正文保存不受影响
    const saved = { stream: ai.streamGenerate };
    ai.streamGenerate = async () => { throw new Error('provider down'); };
    const fbC = await request('/api/writing-feedback', { method: 'POST', body: { novelId: String(novel0._id), sourceChapterNumber: 1, originalText: originalText + '丙', revisedText, reason: 'density' } });
    const failed = await request(`/api/writing-feedback/${fbC.data.feedback._id}/distill`, { method: 'POST', body: {} });
    assert.equal(failed.response.status, 500);
    const fbCAfter = await WritingFeedback.findById(fbC.data.feedback._id);
    assert.equal(fbCAfter.distilledPreferenceId, null, 'failed distillation leaves the feedback reusable');
    ai.streamGenerate = saved.stream;

    // 新鲜度：修改被覆盖后拒绝提炼
    const fbStale = await request('/api/writing-feedback', { method: 'POST', body: { novelId: String(novel0._id), sourceChapterNumber: 1, originalText: originalText + '旧', revisedText: revisedText + '旧版本后来被覆盖', reason: 'emotion' } });
    await request(`/api/novel/${novel0._id}/chapter/1`, { method: 'PUT', body: { content: '这一章被完全重写，旧修改不再包含在内。' } });
    const stale = await request(`/api/writing-feedback/${fbStale.data.feedback._id}/distill`, { method: 'POST', body: {} });
    assert.equal(stale.response.status, 409);

    // 状态流转：确认才生效；停用/恢复
    const confirmed = await request(`/api/writing-preferences/${distilled.data.preference._id}/confirm`, { method: 'POST', body: {} });
    assert.equal(confirmed.data.preference.status, 'active');
    assert.equal((await request(`/api/writing-preferences/${distilled.data.preference._id}/confirm`, { method: 'POST', body: {} })).response.status, 409);
    const paused = await request(`/api/writing-preferences/${distilled.data.preference._id}/pause`, { method: 'POST', body: {} });
    assert.equal(paused.data.preference.status, 'paused');
    assert.equal((await request(`/api/writing-preferences/${distilled.data.preference._id}/activate`, { method: 'POST', body: {} })).data.preference.status, 'active');

    // 手动添加：直接生效；同文幂等；本书范围偏好；跨账号拒绝
    const manual = await request('/api/writing-preferences', { method: 'POST', body: { statement: '每章结尾停在未完成的动作上，而不是情绪总结。' } });
    assert.equal(manual.response.status, 201);
    assert.equal(manual.data.preference.status, 'active');
    assert.equal(manual.data.preference.novelId, null, 'manual preferences default to account-wide');
    assert.equal((await request('/api/writing-preferences', { method: 'POST', body: { statement: '每章结尾停在未完成的动作上，而不是情绪总结。' } })).data.duplicate, true);
    const bookScoped = await request('/api/writing-preferences', { method: 'POST', body: { statement: '这一本书的对白都要带潜台词。', novelId: String(novel1._id) } });
    assert.equal(bookScoped.data.preference.novelId, String(novel1._id));

    // 采用版本：快照只包含账号范围 + 本书范围的 active 偏好（候选/停用/别书均不入）
    const revision = await request('/api/style-revisions', { method: 'POST', body: { name: '偏好注入版' } });
    assert.equal(revision.response.status, 201, JSON.stringify(revision.data));
    const adopt0 = await request(`/api/novel/${novel0._id}/style-revision`, { method: 'PUT', body: { revisionId: revision.data.revision._id } });
    assert.equal(adopt0.response.status, 200, JSON.stringify(adopt0.data));
    const snapshot0 = (await Novel.findById(novel0._id)).styleRevisionSnapshot;
    const statements0 = snapshot0.preferences.map(row => row.statement);
    assert.ok(statements0.some(text2 => text2.includes('每章结尾')), 'account-wide active preference is frozen');
    assert.ok(statements0.some(text2 => text2.includes('动作先于情绪出现')), 'confirmed book preference is frozen');
    assert.ok(!statements0.some(text2 => text2.includes('潜台词')), 'another book preference must not leak');
    const adopt1 = await request(`/api/novel/${novel1._id}/style-revision`, { method: 'PUT', body: { revisionId: revision.data.revision._id } });
    assert.equal(adopt1.response.status, 200);
    const snapshot1 = (await Novel.findById(novel1._id)).styleRevisionSnapshot;
    const statements1 = snapshot1.preferences.map(row => row.statement);
    assert.ok(statements1.some(text2 => text2.includes('潜台词')));
    assert.ok(!statements1.some(text2 => text2.includes('动作先于情绪出现')));

    // 生成注入：偏好块在样稿块之前，章节记录 preferenceIds
    const callsBeforeGen = calls.length;
    const continued = await request(`/api/novel/${novel0._id}/continue-chapter/2`, { method: 'POST', body: { wordCount: 100 } });
    assert.equal(continued.response.status, 200);
    const writingCall = calls.slice(callsBeforeGen).find(call => call.system.includes('专业的小说家') || call.system.includes('续写专家'));
    assert.ok(writingCall, 'a writing call must have been made');
    assert.match(writingCall.system, /【作者确认的写作偏好】/);
    assert.match(writingCall.system, /每章结尾停在未完成的动作上/);
    assert.ok(writingCall.system.indexOf('【作者确认的写作偏好】') < writingCall.system.indexOf('【作者认可的写作样稿】'), 'stable preference block precedes rotating samples');
    const chapter2 = (await Novel.findById(novel0._id)).chapters.find(c => c.chapterNumber === 2);
    assert.ok(Array.isArray(chapter2.styleSamples.preferenceIds) && chapter2.styleSamples.preferenceIds.length >= 1);

    // 停用不影响已采用快照；重新采用才生效
    await request(`/api/writing-preferences/${distilled.data.preference._id}/pause`, { method: 'POST', body: {} });
    const snapshotStill = (await Novel.findById(novel0._id)).styleRevisionSnapshot;
    assert.ok(snapshotStill.preferences.some(row => row.statement.includes('动作先于情绪出现')), 'pausing later must not alter the adopted snapshot');
    const readopt = await request(`/api/novel/${novel0._id}/style-revision`, { method: 'PUT', body: { revisionId: revision.data.revision._id } });
    assert.equal(readopt.response.status, 200);
    const snapshotNew = (await Novel.findById(novel0._id)).styleRevisionSnapshot;
    assert.ok(!snapshotNew.preferences.some(row => row.statement.includes('动作先于情绪出现')), 'paused preference leaves on re-adoption');
  } finally {
    ai.streamGenerate = originalStream;
  }
  const strayCandidates = await WritingPreference.countDocuments({ userId: users[0]._id, status: 'candidate' });
  assert.equal(strayCandidates, 0, 'confirm flow leaves no stray candidates');
});

test('revision entries share the frozen style context; imports and legacy paths stay untouched', async () => {
  const revisedText = '门轴一声轻响，他先看了四周，才跨进门去，顺手把灯绳绕了半圈。';
  const prefStatement = '修订时动作先于情绪出现，让读者从行为里读出紧张。';
  const chapterText = '开篇。' + revisedText + '结尾。' + '他数着自己的心跳，把最后一枚硬币按进掌纹里，门后的呼吸声停了一拍，又继续，像是在等他先开口。'.repeat(2);
  const novel0 = await Novel.create({ userId: users[0]._id, title: '修订上下文书', novelTypeId: 'test', novelTypeName: '测试', chapters: [{ chapterNumber: 1, title: '第一章', content: chapterText, wordCount: chapterText.length }] });
  const novel1 = await Novel.create({ userId: users[0]._id, title: '无版本旧书', novelTypeId: 'test', novelTypeName: '测试', chapters: [{ chapterNumber: 1, title: '第一章', content: chapterText, wordCount: chapterText.length }] });

  const s1 = await request('/api/writing-samples', { method: 'POST', body: { content: revisedText + '它把整段动作放在情绪之前，句子短而克制。', title: '修订样稿', sourceKind: 'own_text' } });
  await request(`/api/writing-samples/${s1.data.sample._id}/approve`, { method: 'POST', body: {} });
  const revision = await request('/api/style-revisions', { method: 'POST', body: { name: '修订上下文版', sampleIds: [s1.data.sample._id] } });
  assert.equal(revision.response.status, 201, JSON.stringify(revision.data));
  const manual = await request('/api/writing-preferences', { method: 'POST', body: { statement: prefStatement } });
  assert.equal(manual.response.status, 201);
  const adopted = await request(`/api/novel/${novel0._id}/style-revision`, { method: 'PUT', body: { revisionId: revision.data.revision._id } });
  assert.equal(adopted.response.status, 200, JSON.stringify(adopted.data));
  assert.ok((await Novel.findById(novel0._id)).styleRevisionSnapshot.preferences.some(row => row.statement === prefStatement));

  const callsBefore = calls.length;
  const deslop = await request('/api/novel/deslop', { method: 'POST', body: { text: chapterText, novelId: String(novel0._id) } });
  assert.equal(deslop.response.status, 200);
  const deslopCall = calls.slice(callsBefore).find(call => call.system.includes('不可改动的基准'));
  assert.ok(deslopCall, 'a deslop call must have been made');
  assert.match(deslopCall.system, /【作者确认的写作偏好】/);
  assert.match(deslopCall.system, /动作先于情绪出现/);
  assert.match(deslopCall.system, /原文是唯一的事实基准/);
  assert.match(deslopCall.system, /【修订纪律】/);
  const deslopLegacy = await request('/api/novel/deslop', { method: 'POST', body: { text: chapterText, novelId: String(novel1._id) } });
  assert.equal(deslopLegacy.response.status, 200);
  const legacyCall = calls.slice(callsBefore).find(call => call.system.includes('不可改动的基准') && !call.system.includes('动作先于情绪出现'));
  assert.ok(legacyCall, 'a legacy deslop call without style context must still work');
  assert.doesNotMatch(legacyCall.system, /【作者确认的写作偏好】|【修订纪律】/);

  const polishCallsBefore = calls.length;
  const polish = await request('/api/novel/polish', { method: 'POST', body: { text: chapterText, novelId: String(novel0._id), doDeslop: false } });
  assert.equal(polish.response.status, 200);
  const polishCall = calls.slice(polishCallsBefore).find(call => call.system.includes('资深小说文字编辑'));
  assert.ok(polishCall, 'a polish call must have been made');
  assert.match(polishCall.system, /【作者确认的写作偏好】/);
  assert.match(polishCall.system, /原文是唯一的事实基准/);

  // 编辑引擎：真实人格优先、无随机作者、阶段系统提示含风格上下文
  const dsl = require('../config/editorialRules');
  const savedDelay = dsl.interStageDelay;
  dsl.interStageDelay = 0;
  const editorialCallsBefore = calls.length;
  const editorial = await request('/api/novel/editorial-stream', { method: 'POST', body: { text: chapterText, novelId: String(novel0._id) } });
  dsl.interStageDelay = savedDelay;
  assert.equal(editorial.response.status, 200, JSON.stringify(editorial.data).slice(0, 200));
  const stageCalls = calls.slice(editorialCallsBefore).filter(call => call.system.includes('编辑') || call.system.includes('签约编辑'));
  assert.ok(stageCalls.length >= 3, 'three editorial stages must call the model');
  for (const call of stageCalls) {
    assert.match(call.system, /【作者确认的写作偏好】|【作者认可的写作样稿】/, 'every stage carries the frozen context');
    assert.doesNotMatch(call.system, /模仿乌贼|教育：|年龄：/, 'no randomly fabricated author');
    assert.doesNotMatch(call.system, /加入废信息和角色走神/, 'noise instructions are gone');
    assert.doesNotMatch(call.prompt, /注入废信息|角色走神|句长随机化|每200字一句|对抗 Entropy|叙述口语化，不用书面语/, 'user prompts must obey the same fidelity rules as system prompts');
  }
  const completedEvent = editorial.data.split('\n').find(line => line.startsWith('data:') && line.includes('"completed"'));
  assert.ok(completedEvent, 'editorial stream must complete');
  assert.equal(JSON.parse(completedEvent.slice(5)).persona, null, 'no persona bound means no fabricated author in the result');

  // 导入续写不注入：源码级守护（规划书 A4 入口表：原声线优先）
  const fs = require('fs');
  const novelRouteSource = fs.readFileSync(require('path').join(__dirname, '../routes/novel.js'), 'utf8');
  const importRouteStart = novelRouteSource.indexOf("router.post('/continue-import'");
  const importRouteEnd = novelRouteSource.indexOf("router.get('/bookshelf'");
  const importRoute = novelRouteSource.slice(importRouteStart, importRouteEnd);
  assert.ok(importRoute.length > 1000);
  assert.ok(!importRoute.includes('buildStyleContext'), 'import continuation must not inject account style context');
});

test('adopted revision persona reaches writing and editing while deactivation restores the book persona', async () => {
  const WritingPersona = require('../models/WritingPersona');
  const persona = await WritingPersona.create({ userId: users[0]._id, name: '版本声线', voice: '版本冻结的轻快声线' });
  const revision = await request('/api/style-revisions', { method: 'POST', body: { name: '带人格的版本', personaId: String(persona._id) } });
  assert.equal(revision.response.status, 201);
  const novel = await Novel.create({ userId: users[0]._id, title: '人格切换验证', novelTypeId: 'test', novelTypeName: '测试', writingPersonaSnapshot: { voice: '作品原有冷峻声线' }, chapters: [{ chapterNumber: 1, content: '原稿。'.repeat(40), wordCount: 120 }] });
  const path = `/api/novel/${novel._id}/style-revision`;
  assert.equal((await request(path, { method: 'PUT', body: { revisionId: revision.data.revision._id } })).response.status, 200);
  await WritingPersona.updateOne({ _id: persona._id }, { $set: { voice: '采用之后修改的模板声线' } });
  const before = calls.length;
  assert.equal((await request(`/api/novel/${novel._id}/continue-chapter/2`, { method: 'POST', body: { wordCount: 100 } })).response.status, 200);
  assert.equal((await request('/api/novel/deslop', { method: 'POST', body: { novelId: String(novel._id), text: '原稿。'.repeat(40) } })).response.status, 200);
  const writing = calls.slice(before).find(call => call.system.includes('专业的小说家'));
  const editing = calls.slice(before).find(call => call.system.includes('不可改动的基准'));
  for (const call of [writing, editing]) {
    assert.ok(call);
    assert.match(call.system, /版本冻结的轻快声线/);
    assert.doesNotMatch(call.system, /作品原有冷峻声线|采用之后修改的模板声线/);
  }
  assert.equal((await request(path, { method: 'PUT', body: { revisionId: null } })).response.status, 200);
  const after = calls.length;
  await request('/api/novel/deslop', { method: 'POST', body: { novelId: String(novel._id), text: '原稿。'.repeat(40) } });
  assert.match(calls[after].system, /作品原有冷峻声线/);
});

test('feedback and preference lists enforce pagination and identical rules retain their book scope', async () => {
  const novel = await Novel.create({ userId: users[0]._id, title: '分页范围验证', novelTypeId: 'test', novelTypeName: '测试' });
  const statement = '只适用于当前作品的规则，人物对白应保留各自的目标。';
  const scoped = await request('/api/writing-preferences', { method: 'POST', body: { novelId: String(novel._id), statement } });
  const global = await request('/api/writing-preferences', { method: 'POST', body: { statement } });
  assert.equal(scoped.response.status, 201);
  assert.equal(global.response.status, 201, 'same statement in another scope must create its own rule');
  assert.notEqual(scoped.data.preference._id, global.data.preference._id);
  await WritingPreference.insertMany(Array.from({ length: 54 }, (_, i) => ({ userId: users[0]._id, novelId: novel._id, statement: `分页规则${i}：保留人物之间的信息差与不同目标。` })));
  await WritingFeedback.insertMany(Array.from({ length: 55 }, (_, i) => ({ userId: users[0]._id, novelId: novel._id, sourceChapterNumber: 1, originalText: '修改前', revisedText: '修改后', originalHash: `before${i}`, revisedHash: `after${i}`, reason: 'pacing' })));
  for (const endpoint of ['writing-feedback', 'writing-preferences']) {
    const listed = await request(`/api/${endpoint}?novelId=${novel._id}&limit=9999`);
    assert.equal(listed.response.status, 200);
    assert.equal(listed.data.limit, 50);
    assert.equal(listed.data.items.length, 50);
    const page2 = await request(`/api/${endpoint}?novelId=${novel._id}&limit=50&page=2`);
    assert.equal(page2.data.items.length, 5);
    assert.ok(!page2.data.items.some(row => listed.data.items.some(first => first._id === row._id)));
  }
});

test('concurrent feedback distillation calls the model once and rejects changes made during the call', async () => {
  const text = '她把钥匙放回桌上，没有回答门外的询问。';
  const novel = await Novel.create({ userId: users[0]._id, title: '提炼并发验证', novelTypeId: 'test', novelTypeName: '测试', chapters: [{ chapterNumber: 1, content: text }] });
  const { validateFeedbackInput } = require('../services/writingStyle');
  const input = validateFeedbackInput({ originalText: '她走了。', revisedText: text, reason: 'emotion' });
  const feedback = await WritingFeedback.create({ userId: users[0]._id, novelId: novel._id, sourceChapterNumber: 1, ...input, originalText: input.originalSlice, revisedText: input.revisedSlice });
  const path = `/api/writing-feedback/${feedback._id}/distill`;
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const originalStream = ai.streamGenerate;
  let count = 0;
  ai.streamGenerate = async () => {
    count++; entered(); await gate;
    return { content: JSON.stringify({ statement: '让人物通过动作与选择表达情绪，避免重复解释已经明确的感受。' }) };
  };
  const first = request(path, { method: 'POST', body: {} });
  try {
    await waitUntil(() => count === 1);
    const repeated = await request(path, { method: 'POST', body: {} });
    assert.equal(repeated.response.status, 409);
    assert.equal(count, 1);
    await Novel.updateOne({ _id: novel._id }, { $set: { 'chapters.0.content': '作者已再次修改了正文。' } });
    release();
    assert.equal((await first).response.status, 409, 'in-flight stale feedback must not become a candidate');
    assert.equal(await WritingPreference.countDocuments({ distilledFromFeedback: feedback._id }), 0);
  } finally { release(); await first; ai.streamGenerate = originalStream; }
});

test('whole-book optimization and editorial failures preserve chapter text byte-for-byte through postprocessing', async () => {
  const original = '然而，他愣住了。总而言之，这扇门打不开，他得回去拿钥匙。'.repeat(20);
  const novel = await Novel.create({ userId: users[0]._id, title: '整本失败保真', novelTypeId: 'test', novelTypeName: '测试', chapters: [{ chapterNumber: 1, content: original, wordCount: original.length }] });
  const dsl = require('../config/editorialRules');
  const delay = dsl.interStageDelay;
  dsl.interStageDelay = 0;
  try {
    for (const [endpoint, task] of [['optimize', 'optimizeTask'], ['editorial-book', 'editorialTask']]) {
      const response = await request(`/api/novel/${endpoint}/${novel._id}`, { method: 'POST', body: {} });
      assert.equal(response.response.status, 200);
      await waitUntil(async () => Boolean((await Novel.findById(novel._id))[task]?.completedAt));
      const saved = await Novel.findById(novel._id);
      assert.equal(saved.chapters[0].content, original);
      assert.equal(saved[task].failedCount, 1);
      assert.equal(saved[task].partial, true);
      assert.equal(saved.chapters[0].qualityReport[task === 'optimizeTask' ? 'optimize' : 'editorial'].applied, false);
    }
    const result = await request('/api/novel/editorial-stream', { method: 'POST', body: { text: original } });
    const completed = result.data.split('\n').find(line => line.startsWith('data:') && line.includes('"completed"'));
    assert.equal(JSON.parse(completed.slice(5)).content, original, 'preview must also skip mechanical replacements after rejecting every model output');
  } finally { dsl.interStageDelay = delay; }
});

test('recovery looks up lost creation responses by account and preserves expired-job drafts and initial inputs', async () => {
  const { captureGenerationInput } = require('../services/generationInput');
  const { resumeGenerationJob, finalizeGenerationJob } = require('../services/generationJob');
  const requestId = 'isolated-recovery-request-123456';
  const snapshot = captureGenerationInput({ novelTypeId: 'test', mode: 'chapter', worldSetting: '建书时的设定', outline: '建书时的大纲', enableResearch: false });
  const novel = await Novel.create({ userId: users[0]._id, title: '卡顿恢复测试', novelTypeId: 'test', novelTypeName: '测试', status: 'generating', generationRequestId: requestId,
    generationInput: snapshot, outline: '后来改过的大纲', chapters: [{ chapterNumber: 1, content: '已提交的正文。' }] });
  const foreign = await request(`/api/novel/generation-request/${requestId}`, { user: 1 });
  assert.equal(foreign.data.novelId, null);
  assert.equal((await request(`/api/novel/${novel._id}/generation-input`, { user: 1 })).response.status, 404);
  const restored = await request(`/api/novel/${novel._id}/generation-input`);
  assert.equal(restored.data.exact, true); assert.equal(restored.data.input.outline, '建书时的大纲');
  assert.equal(restored.data.input.enableResearch, false);
  const job = await resumeGenerationJob({ novelId: novel._id, kind: 'novel', leaseOwner: 'recovery-test', leaseMs: 60000 });
  try {
    const active = await request(`/api/novel/generation-request/${requestId}`);
    assert.equal(active.data.active, true);
    assert.equal(active.data.novelId, String(novel._id));
    await GenerationJob.updateOne({ jobId: job.jobId }, { $set: { leaseUntil: new Date(Date.now() - 1000), draft: '中断前的草稿。' } });
    const expired = await request(`/api/novel/generation-request/${requestId}`);
    assert.equal(expired.data.active, false);
    assert.equal(expired.data.job.draftLength, '中断前的草稿。'.length);
    const saved = await Novel.findById(novel._id);
    assert.equal(saved.chapters[0].content, '已提交的正文。');
    assert.equal(saved.status, 'paused');
    assert.equal(saved.generationInput.outline, '建书时的大纲');
    await assert.rejects(Novel.create({ userId: users[0]._id, novelTypeId: 'test', novelTypeName: '测试', generationRequestId: requestId }), { code: 11000 });
  } finally {
    await finalizeGenerationJob({ jobId: job.jobId, leaseOwner: 'recovery-test', fencingToken: job.fencingToken, status: 'completed' }).catch(() => {});
  }
});
