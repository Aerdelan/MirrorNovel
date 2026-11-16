const test = require('node:test');
const assert = require('node:assert/strict');
const { recoverChapterStream } = require('../services/chapterStreamRecovery');
const interrupted = () => Object.assign(new Error('connection reset'), { resumable: true });

test('a dropped provider stream checkpoints and continues the exact prefix, without restarting the chapter', async () => {
  let draft = '恢复前已保存的开头。';
  const prefixes = [], saved = [], notices = [];
  const result = await recoverChapterStream({
    readDraft: () => draft,
    generate: async prefix => {
      prefixes.push(prefix);
      if (prefixes.length === 1) { draft += '掉线前的新正文。'; throw interrupted(); }
      draft += '恢复后的后文。'; return { content: '恢复后的后文。' };
    },
    checkpoint: async phase => saved.push([phase, draft]),
    onRetry: event => notices.push(event), wait: async () => {},
  });
  assert.deepEqual(prefixes, ['恢复前已保存的开头。', '恢复前已保存的开头。掉线前的新正文。']);
  assert.equal(draft, '恢复前已保存的开头。掉线前的新正文。恢复后的后文。');
  assert.equal(result.content, '恢复后的后文。');
  assert.deepEqual(saved, [['writing_interrupted', prefixes[1]]]);
  assert.equal(notices.length, 1);
});

test('repeated interruptions have a bounded retry budget and preserve the last draft', async () => {
  let draft = '', calls = 0, writes = 0;
  await assert.rejects(recoverChapterStream({ readDraft: () => draft,
    generate: async () => { calls++; draft += '新正文。'; throw interrupted(); },
    checkpoint: async () => writes++, wait: async () => {},
  }), /connection reset/);
  assert.equal(calls, 3); assert.equal(writes, 3); assert.equal(draft, '新正文。'.repeat(3));
});

test('empty progress, permanent errors and lost leases never initiate another generation', async () => {
  for (const kind of ['empty', 'permanent', 'lease']) {
    let calls = 0, draft = '已有草稿。';
    await assert.rejects(recoverChapterStream({ readDraft: () => draft,
      generate: async () => { calls++; if (kind !== 'empty') draft += '新片段。'; throw kind === 'permanent' ? new Error('invalid API key') : interrupted(); },
      checkpoint: async () => { if (kind === 'lease') throw new Error('stale lease'); }, wait: async () => {},
    }), kind === 'lease' ? /stale lease/ : kind === 'permanent' ? /invalid API key/ : /connection reset/);
    assert.equal(calls, 1);
  }
});

test('Pause interrupts the recovery backoff instead of resubmitting a chapter', async () => {
  const controller = new AbortController(); let draft = '', calls = 0;
  const promise = recoverChapterStream({ signal: controller.signal, readDraft: () => draft,
    generate: async () => { calls++; draft += '已生成内容。'; throw interrupted(); },
    checkpoint: async () => {}, onRetry: () => controller.abort(),
  });
  await assert.rejects(promise, error => error.name === 'AbortError');
  assert.equal(calls, 1); assert.equal(draft, '已生成内容。');
});
