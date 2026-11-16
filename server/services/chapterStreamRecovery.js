// Retry only a provider stream that explicitly returned a recoverable prefix.
// Never restart a chapter, retry a failed commit, or turn Pause into new work.
function waitForRetry(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      const error = new Error('生成已暂停');
      error.name = 'AbortError';
      reject(error);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

async function recoverChapterStream({ generate, readDraft, checkpoint, signal, onRetry,
  maxResumes = 2, wait = waitForRetry }) {
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) {
      const error = new Error('生成已暂停');
      error.name = 'AbortError';
      throw error;
    }
    const prefix = String(readDraft() || '');
    try {
      return await generate(prefix);
    } catch (error) {
      // A failed checkpoint/lease must stop this writer, even if the provider
      // error itself could be retried. No second writer can race a lost lease.
      await checkpoint('writing_interrupted');
      const draft = String(readDraft() || '');
      if (signal?.aborted || error?.resumable !== true || attempt >= maxResumes
        || draft.length <= prefix.length || !draft.startsWith(prefix)) throw error;
      onRetry?.({ attempt: attempt + 1, maxResumes, draftLength: draft.length });
      await wait(1000 * (attempt + 1), signal);
    }
  }
}

module.exports = { recoverChapterStream };
