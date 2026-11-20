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

// A resumed stream can replay the end of the existing draft. Buffer only
// while an exact suffix match is possible, then forward new bytes once.
function createChapterContinuationWriter(draft, onChunk) {
  const tail = String(draft || '').slice(-6000);
  const minimum = 32;
  let prefix = '';
  let pending = tail.length >= minimum;
  let candidates;
  let overlap = 0;
  let added = '';

  function forward(text) {
    if (!text) return;
    onChunk?.(text);
    added += text;
  }

  function finish(interrupted = false) {
    if (!pending) return added;
    pending = false;
    // On a second interruption the stream may end in the middle of a replay,
    // before we have reached the end of the saved draft.
    const replayOnly = interrupted && prefix.length >= minimum && candidates?.length;
    forward(prefix.slice(replayOnly ? prefix.length : overlap));
    prefix = '';
    return added;
  }

  return {
    write(chunk) {
      if (!pending) { forward(chunk); return; }
      prefix += chunk;
      if (prefix.length < minimum) return;
      if (!candidates) {
        candidates = [];
        const anchor = prefix.slice(0, minimum);
        for (let at = tail.indexOf(anchor); at !== -1; at = tail.indexOf(anchor, at + 1)) {
          candidates.push(at);
        }
      }
      candidates = candidates.filter(at => {
        const suffix = tail.slice(at);
        if (prefix.length < suffix.length) return suffix.startsWith(prefix);
        if (prefix.startsWith(suffix)) overlap = Math.max(overlap, suffix.length);
        return false;
      });
      if (!candidates.length) finish();
    },
    finish,
  };
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

module.exports = { recoverChapterStream, createChapterContinuationWriter };
