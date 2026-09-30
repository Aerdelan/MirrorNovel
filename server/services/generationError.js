const PHASES = {
  preparing: '检查创作设置',
  saving_novel: '保存新作品',
  starting_job: '初始化生成任务',
  research: '联网取材',
  outline: '保存或生成大纲',
  blueprint: '初始化故事蓝图',
  chapter_plan: '制定章节计划',
  creative_state: '初始化章节执行计划',
};

function redactError(value) {
  return String(value || '')
    .replace(/\bsk[-_][A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/((?:["']?(?:api[_-]?key|password|authorization)["']?)\s*[=:]\s*["']?)[^\s,;"']+/gi, '$1[REDACTED]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@');
}

function describeGenerationFailure(error, phase, errorId) {
  const busy = error?.code === 'GENERATION_LEASE_BUSY';
  const database = /^(Mongo|Mongoose)/.test(error?.name || '');
  const validation = error?.name === 'ValidationError' || error?.name === 'CastError';
  const reason = busy ? '这部小说正在另一项任务中生成，请先暂停或稍后再试'
    : error?.isApiError ? redactError(error.message)
      : validation ? '创作设置无法保存，请检查所选类型和写作风格'
        : database ? '作品数据库暂时不可用，请稍后重试'
          : '服务端处理失败，需要查看对应错误日志';
  return {
    status: busy ? 409 : error?.isApiError ? 503 : validation ? 400 : 500,
    message: `${PHASES[phase] || PHASES.preparing}失败：${reason}（错误编号：${errorId}）`,
    phase,
    errorId,
  };
}

function describeChapterFailure(error, fallback) {
  if (error?.code === 'CHAPTER_CONTRACT_BLOCKED') {
    return `章节校验未通过：${redactError((error.commitAudit?.blockers || []).join('；') || error.message)}。草稿已保留，可调整设置后继续`;
  }
  return error?.isApiError ? redactError(error.message || fallback) : fallback;
}

module.exports = { describeGenerationFailure, describeChapterFailure, redactError };
