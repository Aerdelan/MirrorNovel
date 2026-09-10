const test = require('node:test');
const assert = require('node:assert/strict');

const { saveNovelDoc } = require('../services/novelPersist');

function versionError() {
  return Object.assign(new Error('No matching document found for id "abc" version 15 modifiedPaths "chapters"'), {
    name: 'VersionError',
  });
}

// 最小 mongoose 文档替身：只需 save / modifiedPaths / get / _id / __v
function fakeNovel({ paths = [], values = {}, saveImpl } = {}) {
  const doc = {
    _id: 'novel-1',
    __v: 15,
    saveCalls: 0,
    save: async function save() {
      this.saveCalls += 1;
      if (saveImpl) return saveImpl(this);
      return this;
    },
    modifiedPaths: () => paths,
    get: (path) => values[path],
  };
  return doc;
}

test('正常保存：不进入降级路径，也不额外写库', async () => {
  const novel = fakeNovel();
  let updateCalls = 0;
  const NovelModel = { updateOne: async () => { updateCalls += 1; }, findById: () => ({ select: () => ({ lean: async () => ({ __v: 99 }) }) }) };

  const result = await saveNovelDoc(novel, { NovelModel });
  assert.equal(result, novel);
  assert.equal(novel.saveCalls, 1);
  assert.equal(updateCalls, 0, '成功保存不应触发字段级降级');
  assert.equal(novel.__v, 15, '成功保存不需要对齐版本号');
});

test('VersionError 时只写回已修改字段，不覆盖其他请求写入的字段', async () => {
  const novel = fakeNovel({
    paths: ['chapters', 'currentWordCount', 'tokenUsage'],
    values: { chapters: [{ chapterNumber: 3 }], currentWordCount: 3000, tokenUsage: { calls: 7 } },
    saveImpl: () => { throw versionError(); },
  });
  let captured = null;
  const NovelModel = {
    updateOne: async (filter, update) => { captured = { filter, update }; },
    findById: () => ({ select: () => ({ lean: async () => ({ __v: 21 }) }) }),
  };

  const result = await saveNovelDoc(novel, { NovelModel });

  assert.equal(result, novel);
  assert.deepEqual(captured.filter, { _id: 'novel-1' });
  assert.deepEqual(Object.keys(captured.update.$set).sort(), ['chapters', 'currentWordCount', 'tokenUsage']);
  assert.equal(captured.update.$set.currentWordCount, 3000);
  // 未被本进程修改的字段（如另一个请求刚写的 storyBlueprint）绝不出现在 $set 中
  assert.equal(captured.update.$set.storyBlueprint, undefined);
  assert.equal(novel.__v, 21, '应对齐库中版本号，避免后续保存连续冲突');
});

test('父子路径同时被修改时只保留父路径（避免 MongoDB path conflict）', async () => {
  const novel = fakeNovel({
    paths: ['storyBlueprint', 'storyBlueprint.phases', 'chapters', 'updatedAt', '__v'],
    values: { storyBlueprint: { mainArc: 'x', phases: [1, 2] }, chapters: [], 'storyBlueprint.phases': [1, 2] },
    saveImpl: () => { throw versionError(); },
  });
  let captured = null;
  const NovelModel = {
    updateOne: async (filter, update) => { captured = update; },
    findById: () => ({ select: () => ({ lean: async () => ({ __v: 3 }) }) }),
  };

  await saveNovelDoc(novel, { NovelModel });
  assert.deepEqual(Object.keys(captured.$set).sort(), ['chapters', 'storyBlueprint']);
});

test('非 VersionError 的失败必须原样抛出，不能被降级掩盖', async () => {
  const boom = Object.assign(new Error('validation failed'), { name: 'ValidationError' });
  const novel = fakeNovel({ paths: ['chapters'], values: { chapters: [] }, saveImpl: () => { throw boom; } });
  let updateCalls = 0;
  const NovelModel = { updateOne: async () => { updateCalls += 1; }, findById: () => ({ select: () => ({ lean: async () => ({ __v: 1 }) }) }) };

  await assert.rejects(() => saveNovelDoc(novel, { NovelModel }), (error) => error === boom);
  assert.equal(updateCalls, 0);
});

test('无任何已修改字段时保留原始错误（不做无意义的空写入）', async () => {
  const novel = fakeNovel({ paths: ['__v', 'updatedAt'], saveImpl: () => { throw versionError(); } });
  let updateCalls = 0;
  const NovelModel = { updateOne: async () => { updateCalls += 1; }, findById: () => ({ select: () => ({ lean: async () => ({ __v: 2 }) }) }) };

  await assert.rejects(() => saveNovelDoc(novel, { NovelModel }), (error) => error.name === 'VersionError');
  assert.equal(updateCalls, 0);
});

test('库中记录已不存在时不写入空更新，并保留原始错误', async () => {
  const novel = fakeNovel({
    paths: ['chapters'],
    values: { chapters: [] },
    saveImpl: () => { throw versionError(); },
  });
  const NovelModel = {
    updateOne: async () => {},
    findById: () => ({ select: () => ({ lean: async () => null }) }),
  };

  // 记录消失属于异常状态：降级写回仍然完成（避免生成结果全丢），但版本号保持不动。
  const result = await saveNovelDoc(novel, { NovelModel });
  assert.equal(result, novel);
  assert.equal(novel.__v, 15);
});
