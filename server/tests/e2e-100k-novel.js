/**
 * 端到端自动化流水线测试：使用管理员账号编写一本十万字小说
 * 
 * 测试目标：
 *   1. 登录、积分、大纲、生成、续写、查询、导出 全流程打通
 *   2. 监控 AI 服务（智谱 glm-4.7）的稳定性与响应速度
 *   3. 发现并记录系统异常点
 * 
 * 用法：node server/tests/e2e-100k-novel.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000';
const TARGET = 100000;
const REPORT_DIR = path.resolve(__dirname, '../../tmp_e2e_report');
const REPORT_FILE = path.join(REPORT_DIR, 'report.json');
const NOVEL_FILE = path.join(REPORT_DIR, 'novel.txt');

// 确保目录存在
if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

const report = {
  startedAt: new Date().toISOString(),
  phases: [],
  issues: [],
  novel: { id: null, title: null, finalWordCount: 0, chapters: 0 },
};

function log(phase, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  const line = `[${ts}] [${phase}] ${msg}`;
  console.log(line);
  report.phases.push({ ts, phase, msg });
}

function issue(category, severity, description, context = {}) {
  const entry = { ts: new Date().toISOString(), category, severity, description, context };
  report.issues.push(entry);
  console.error(`  ⚠️ [ISSUE ${severity}] ${category}: ${description}`);
  // 实时落盘
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf8');
}

function saveReport() {
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf8');
}

// ============ HTTP 工具 ============
function request(method, urlPath, body, token, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const req = http.request({
      method, hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      timeout: timeoutMs,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data || '{}'), raw: data });
        } catch {
          resolve({ status: res.statusCode, data: null, raw: data });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// SSE 流式请求：逐事件回调，返回 { finalType, finalMessage, events }
function sseRequest(method, urlPath, body, token, { timeoutMs = 30 * 60 * 1000, onEvent } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const req = http.request({
      method, hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Accept': 'text/event-stream',
      },
      timeout: timeoutMs,
    }, (res) => {
      if (res.statusCode >= 400) {
        let errBody = '';
        res.on('data', c => errBody += c);
        res.on('end', () => reject(new Error(`SSE HTTP ${res.statusCode}: ${errBody.slice(0, 300)}`)));
        return;
      }
      let buffer = '';
      const events = [];
      let finalEvent = null;
      const timer = setTimeout(() => { req.destroy(); reject(new Error('SSE timeout')); }, timeoutMs);
      res.on('data', chunk => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const payload = trimmed.slice(6);
          try {
            const ev = JSON.parse(payload);
            events.push(ev);
            if (onEvent) onEvent(ev);
            if (['completed','paused','error','token_exhausted','plan_needs_extension'].includes(ev.type)) {
              finalEvent = ev;
            }
          } catch {}
        }
      });
      res.on('end', () => {
        clearTimeout(timer);
        resolve({ finalType: finalEvent?.type || 'stream_end', finalEvent, events, status: res.statusCode });
      });
      res.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('SSE connect timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ============ 测试步骤 ============
async function phaseLogin() {
  log('LOGIN', '登录管理员账号');
  const r = await request('POST', '/api/auth/login', { email: 'admin@xiaoshuo.com', password: 'admin888' });
  if (r.status !== 200 || !r.data.token) throw new Error('登录失败: ' + JSON.stringify(r.data));
  log('LOGIN', `✅ 登录成功, user=${r.data.user?.nickname || r.data.user?.email}`);
  return r.data.token;
}

async function phaseEnsurePoints(token) {
  log('POINTS', '检查管理员积分余额');
  const me = await request('GET', '/api/auth/profile', null, token);
  const available = me.data?.points?.available ?? me.data?.tokens?.available ?? 0;
  log('POINTS', `当前可用积分: ${available}`);
  if (available < 50000) {
    log('POINTS', '积分不足，尝试通过 admin 接口充值');
    // 获取 admin 自己的 userId
    const users = await request('GET', '/api/admin/users', null, token);
    const adminUser = (users.data?.users || []).find(u => u.email === 'admin@xiaoshuo.com');
    if (!adminUser) throw new Error('无法在 admin 用户列表中定位管理员');
    const credit = await request('PUT', `/api/admin/users/${adminUser._id}`, { addPoints: 200000 }, token);
    if (credit.status !== 200) issue('POINTS', 'ERROR', 'admin 充值失败: ' + JSON.stringify(credit.data));
    else log('POINTS', '✅ 充值 200000 积分完成');
  } else {
    log('POINTS', '✅ 积分充足，无需充值');
  }
}

async function phaseNovelTypes() {
  log('TYPES', '获取小说类型列表');
  const r = await request('GET', '/api/novel/types');
  if (r.status !== 200) throw new Error('获取类型失败: ' + r.status);
  const types = r.data || [];
  log('TYPES', `✅ 共 ${types.length} 种类型`);
  // 选择"都市"类型，便于快速生成
  const urban = types.find(t => t.name === '都市' || t.id === 'urban') || types[0];
  return urban;
}

async function phaseOutline(token, novelType) {
  log('OUTLINE', '生成大纲（同步）');
  const t0 = Date.now();
  const r = await request('POST', '/api/novel/generate-outline', {
    novelTypeId: novelType.id,
    protagonistName: '陈墨',
    worldSetting: '现代都市商战背景，主角出身草根，在金融圈步步为营',
    targetWordCount: TARGET,
  }, token, { timeoutMs: 300000 });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  if (r.status !== 200 || !r.data.outline) {
    issue('OUTLINE', 'ERROR', '大纲生成失败', { status: r.status, data: r.data });
    throw new Error('大纲生成失败');
  }
  log('OUTLINE', `✅ 大纲生成完成, ${dt}s, 长度 ${r.data.outline.length} 字`);
  return r.data.outline;
}

async function phaseGenerate(token, novelType, outline) {
  log('GEN', '开始生成小说（整本模式，SSE）');
  const t0 = Date.now();
  let novelId = null;
  let lastChapter = 0;
  let lastWords = 0;
  let statusUpdates = 0;
  let chapterEvents = [];

  const result = await sseRequest('POST', '/api/novel/generate', {
    novelTypeId: novelType.id,
    protagonistName: '陈墨',
    worldSetting: '现代都市商战背景，主角出身草根，在金融圈步步为营',
    targetWordCount: TARGET,
    mode: 'book',
    outline,
  }, token, {
    timeoutMs: 45 * 60 * 1000,
    onEvent: (ev) => {
      statusUpdates++;
      if (ev.type === 'novel_created') { novelId = ev.novelId; log('GEN', `小说已创建: ${novelId}`); }
      else if (ev.type === 'chapter_start') { lastChapter = ev.chapterNumber; log('GEN', `▶ 第 ${ev.chapterNumber} 章开始`); }
      else if (ev.type === 'chapter_end') {
        lastWords += (ev.wordCount || 0);
        chapterEvents.push(ev);
        log('GEN', `✓ 第 ${ev.chapterNumber} 章完成, ${ev.wordCount} 字, 累计 ${lastWords} 字`);
      }
      else if (ev.type === 'outline') log('GEN', `大纲下发 ${ev.content.length} 字`);
      else if (ev.type === 'status') log('GEN', `[status] ${ev.message}`);
      else if (ev.type === 'quality_notice') log('GEN', `质量提示 ch${ev.chapterNumber}: ${JSON.stringify(ev.report).slice(0, 120)}`);
      else if (ev.type === 'token_exhausted') issue('GEN', 'ERROR', '积分耗尽');
      else if (ev.type === 'error') issue('GEN', 'ERROR', '生成错误: ' + ev.message, { ev });
      else if (ev.type === 'plan_needs_extension') issue('GEN', 'WARN', '计划需扩展: ' + ev.message);
    },
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  log('GEN', `首轮结束: 状态=${result.finalType}, ${dt}s, ${statusUpdates} 个事件, ${chapterEvents.length} 章, 累计约 ${lastWords} 字`);
  return { novelId, finalType: result.finalType, wordCount: lastWords, chapterCount: chapterEvents.length };
}

async function phaseContinueLoop(token, novelId) {
  let rounds = 0;
  let totalWords = 0;
  while (rounds < 50) {
    rounds++;
    log('CONT', `第 ${rounds} 轮续写`);
    // 先拉一次详情看进度
    const detail = await request('GET', `/api/novel/${novelId}`, null, token);
    if (detail.status !== 200) { issue('CONT', 'ERROR', '详情拉取失败: ' + detail.status); break; }
    const current = detail.data.currentWordCount || 0;
    const status = detail.data.status;
    totalWords = current;
    log('CONT', `当前进度: ${current}/${TARGET} 字, 状态=${status}, 章节=${(detail.data.chapters || []).length}`);

    if (current >= TARGET) {
      log('CONT', `✅ 已达目标字数 (${current} ≥ ${TARGET})`);
      break;
    }
    if (status === 'completed') {
      issue('CONT', 'WARN', `状态 completed 但字数 ${current} < 目标 ${TARGET}`, { current });
      // 之前已修复：completed 但字数不足会允许继续
    }

    const t0 = Date.now();
    let roundsChapters = 0;
    const result = await sseRequest('POST', `/api/novel/continue/${novelId}`, { mode: 'book' }, token, {
      timeoutMs: 45 * 60 * 1000,
      onEvent: (ev) => {
        if (ev.type === 'chapter_start') log('CONT', `  ▶ 第 ${ev.chapterNumber} 章开始`);
        else if (ev.type === 'chapter_end') {
          roundsChapters++;
          log('CONT', `  ✓ 第 ${ev.chapterNumber} 章完成, ${ev.wordCount} 字`);
        }
        else if (ev.type === 'token_exhausted') issue('CONT', 'ERROR', '积分耗尽', { ev });
        else if (ev.type === 'error') issue('CONT', 'ERROR', '续写错误: ' + ev.message, { ev });
        else if (ev.type === 'plan_needs_extension') issue('CONT', 'WARN', '计划需扩展: ' + ev.message);
        else if (ev.type === 'status') log('CONT', `  [status] ${ev.message}`);
      },
    });
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    log('CONT', `第 ${rounds} 轮结束: ${result.finalType}, ${dt}s, ${roundsChapters} 章`);

    if (result.finalType === 'token_exhausted') { issue('CONT', 'ERROR', '积分耗尽终止'); break; }
    if (result.finalType === 'error') { issue('CONT', 'ERROR', '续写出错终止'); break; }
    if (result.finalType === 'plan_needs_extension') {
      issue('CONT', 'INFO', '计划扩展事件 — 测试继续（无计划自然续写）');
    }
    // 防止空转
    if (roundsChapters === 0 && result.finalType !== 'completed') {
      issue('CONT', 'WARN', '本轮无新增章节，终止循环以避免空转', { finalType: result.finalType });
      break;
    }
  }
  return totalWords;
}

async function phaseExport(token, novelId) {
  log('EXPORT', '导出小说');
  const r = await request('POST', '/api/novel/export', { novelId, format: 'txt' }, token);
  if (r.status !== 200) {
    // fallback：通过详情接口自己拼
    issue('EXPORT', 'WARN', '导出接口异常，降级拼接: ' + JSON.stringify(r.data).slice(0, 200));
    const detail = await request('GET', `/api/novel/${novelId}`, null, token);
    const chapters = detail.data.chapters || [];
    const text = `${detail.data.title}\n\n` + chapters.map(c => `第${c.chapterNumber}章\n\n${c.content}`).join('\n\n---\n\n');
    fs.writeFileSync(NOVEL_FILE, text, 'utf8');
    report.novel.title = detail.data.title;
    report.novel.finalWordCount = detail.data.currentWordCount;
    report.novel.chapters = chapters.length;
  } else {
    fs.writeFileSync(NOVEL_FILE, r.raw || r.data.content || '', 'utf8');
    report.novel.finalWordCount = (r.raw || r.data.content || '').length;
  }
  log('EXPORT', `✅ 小说已保存至 ${NOVEL_FILE}`);
}

// ============ 主流程 ============
async function main() {
  console.log(`\n========== 十万字小说端到端流水线测试 ==========`);
  console.log(`目标: ${TARGET} 字 | 后端: ${BASE} | 报告: ${REPORT_FILE}\n`);

  let token, novelType, outline, novelId;
  try {
    // Phase 1: 登录
    token = await phaseLogin();

    // Phase 2: 积分
    await phaseEnsurePoints(token);

    // Phase 3: 类型
    novelType = await phaseNovelTypes();
    log('TYPES', `选择类型: ${novelType.name} (${novelType.id})`);

    // Phase 4: 大纲
    outline = await phaseOutline(token, novelType);

    // Phase 5: 首轮生成
    const genResult = await phaseGenerate(token, novelType, outline);
    novelId = genResult.novelId;
    report.novel.id = novelId;

    if (genResult.wordCount < TARGET) {
      // Phase 6: 续写循环
      await phaseContinueLoop(token, novelId);
    }

    // Phase 7: 导出
    await phaseExport(token, novelId);

  } catch (err) {
    issue('MAIN', 'FATAL', '流水线主流程异常: ' + err.message, { stack: err.stack });
  } finally {
    report.endedAt = new Date().toISOString();
    report.summary = {
      durationMin: ((new Date(report.endedAt) - new Date(report.startedAt)) / 60000).toFixed(1),
      issueCount: report.issues.length,
      novelId,
      finalWordCount: report.novel.finalWordCount,
      chapters: report.novel.chapters,
      reachedTarget: report.novel.finalWordCount >= TARGET,
    };
    saveReport();
    console.log(`\n========== 测试结束 ==========`);
    console.log(`耗时: ${report.summary.durationMin} 分钟`);
    console.log(`异常: ${report.summary.issueCount} 个`);
    console.log(`小说: ${report.novel.finalWordCount} 字 / ${report.novel.chapters} 章`);
    console.log(`达标: ${report.summary.reachedTarget ? '✅' : '❌'}`);
    console.log(`报告: ${REPORT_FILE}`);
    console.log(`正文: ${NOVEL_FILE}`);
  }
}

main().catch(err => {
  console.error('未捕获异常:', err);
  process.exit(1);
});
