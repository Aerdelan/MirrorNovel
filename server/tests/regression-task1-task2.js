/**
 * 综合回归测试：验证任务一（e2e 100k）和任务二（润色调优 + 导出）的修改是否生效，
 * 以及是否与其他功能产生冲突。
 *
 * 任务一相关：
 *   T1-A  登录接口
 *   T1-B  Vite 代理（client 5173 / admin 5174）均指向 3000
 *   T1-C  积分充值
 *   T1-D  书架 + 小说详情
 *   T1-E  "completed 但字数不足" 的小说允许续写
 *   T1-F  "无章节计划" 的小说在 book 模式下自然续写
 *   T1-G  前端 plan_needs_extension 事件（通过续写触发验证）
 *   T1-H  生成单章（generate SSE 短路径）
 *   T1-I  导出已有小说（旧 /export 路由，检查是否受新代码影响）
 *
 * 任务二相关：
 *   T2-A  润色（含诊断）
 *   T2-B  润色（不含诊断）
 *   T2-C  润色（带 genre）
 *   T2-D  润色（带自定义 prompt）
 *   T2-E  导出 TXT
 *   T2-F  导出 MD（多章）
 *   T2-G  导出 EPUB（ZIP 格式校验）
 *   T2-H  保存回小说（append）
 *   T2-I  保存回小说（覆盖指定章节）
 *   T2-J  去 AI 味（/deslop 接口回归）
 *   T2-K  编辑引擎（/deslop-stream SSE 回归）
 *
 * 冲突检查：
 *   C-A   /api/novel/types 仍可用
 *   C-B   /api/novel/generate-outline 仍可用
 *   C-C   /api/auth/profile 仍可用
 *   C-D   /api/admin/users 列表仍可用
 *   C-E   /api/health 健康检查
 *   C-F   旧 /api/novel/export 路由与新增 /polish-export 共存
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

// 测试脚本需要 mongoose 来直接写库（用于构造测试数据）
const mongoose = require('mongoose');

const BASE = 'http://localhost:3000';
const CLIENT = 'http://localhost:5173';
const ADMIN = 'http://localhost:5174';
const REPORT = path.resolve(__dirname, '../../tmp_e2e_report/regression-report.json');

const results = [];
const issues = [];
let token = '';
let adminUserId = '';
let targetNovelId = '';
let createdNovelId = '';

function report(name, ok, details = {}) {
  results.push({ name, ok, ...details });
  const mark = ok ? '✅' : '❌';
  const msg = details.msg ? ` (${details.msg})` : '';
  console.log(`${mark} ${name}${msg}`);
  if (!ok && details.error) {
    issues.push({ name, error: String(details.error).slice(0, 400) });
  }
}

function req(method, url, body, tokenArg, { timeoutMs = 30000, parseJson = true } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url, BASE);
    const r = http.request({
      method, hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      headers: { 'Content-Type': 'application/json', ...(tokenArg ? { Authorization: `Bearer ${tokenArg}` } : {}) },
      timeout: timeoutMs,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (parseJson) {
          try { resolve({ status: res.statusCode, data: JSON.parse(data || '{}'), raw: data, headers: res.headers }); }
          catch { resolve({ status: res.statusCode, data: null, raw: data, headers: res.headers }); }
        } else {
          resolve({ status: res.statusCode, data, headers: res.headers });
        }
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

function sse(url, body, tokenArg, { timeoutMs = 120000, onEvent } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url, BASE);
    const r = http.request({
      method: 'POST', hostname: u.hostname, port: u.port, path: u.pathname,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenArg}`, Accept: 'text/event-stream' },
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
      const timer = setTimeout(() => { r.destroy(); reject(new Error('SSE timeout')); }, timeoutMs);
      res.on('data', chunk => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            events.push(ev);
            if (onEvent) onEvent(ev);
          } catch {}
        }
      });
      res.on('end', () => {
        clearTimeout(timer);
        resolve({ status: res.statusCode, events, headers: res.headers });
      });
      res.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('SSE connect timeout')); });
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

// ============================================================
// 任务一：e2e 流水线修改验证
// ============================================================
async function taskOneTests() {
  console.log('\n===== 任务一：e2e 流水线修改验证 =====');

  // T1-A 登录
  try {
    const r = await req('POST', '/api/auth/login', { email: 'admin@xiaoshuo.com', password: 'admin888' });
    if (r.status === 200 && r.data.token) {
      token = r.data.token;
      report('T1-A 登录接口', true, { msg: '成功' });
    } else {
      report('T1-A 登录接口', false, { msg: `HTTP ${r.status}`, error: r.raw });
    }
  } catch (e) { report('T1-A 登录接口', false, { error: e.message }); }

  // T1-B Vite 代理（client 5173 / admin 5174）
  for (const [label, origin] of [['T1-B1 client 5173 代理', CLIENT], ['T1-B2 admin 5174 代理', ADMIN]]) {
    try {
      const r = await new Promise((resolve, reject) => {
        const u = new URL('/api/health', origin);
        http.get({ hostname: u.hostname, port: u.port, path: u.pathname, timeout: 10000 }, (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => resolve({ status: res.statusCode, data }));
        }).on('error', reject);
      });
      const ok = r.status === 200 && /"status"\s*:\s*"ok"/.test(r.data);
      report(label, ok, { msg: `status=${r.status}` });
    } catch (e) { report(label, false, { error: e.message }); }
  }

  // T1-C 积分余额（已有 200k）
  try {
    const r = await req('GET', '/api/auth/profile', null, token);
    const available = r.data?.user?.points?.available ?? r.data?.user?.availablePoints ?? r.data?.points?.available ?? 0;
    report('T1-C 积分余额', available > 0, { msg: `${available} 积分` });
  } catch (e) { report('T1-C 积分余额', false, { error: e.message }); }

  // T1-D 书架 + 小说详情
  try {
    const books = await req('GET', '/api/novel/bookshelf', null, token);
    if (books.status !== 200 || !Array.isArray(books.data)) {
      report('T1-D 书架', false, { msg: `HTTP ${books.status}` });
    } else {
      report('T1-D 书架', true, { msg: `共 ${books.data.length} 本` });
      // 选一个 currentWordCount >= targetWordCount 的小说（用于 T1-F）
      const reached = books.data.find(b => (b.currentWordCount || 0) >= (b.targetWordCount || 0) && (b.currentWordCount || 0) > 0);
      const target = reached || books.data[0];
      if (target) {
        targetNovelId = target._id;
        const detail = await req('GET', `/api/novel/${target._id}`, null, token);
        report('T1-D 小说详情', detail.status === 200, { msg: `${detail.data?.title} (${detail.data?.currentWordCount}字 / ${(detail.data?.chapters || []).length}章)` });
      }
    }
  } catch (e) { report('T1-D 书架', false, { error: e.message }); }

  // T1-H 生成单章（短路径，避免耗时）
  try {
    const types = await req('GET', '/api/novel/types', null, token);
    const type = types.data?.[0];
    let genNovelId = null;
    let gotChapter = false;
    const r = await sse('/api/novel/generate', {
      novelTypeId: type.id, protagonistName: '测试',
      worldSetting: '测试世界观', targetWordCount: 10000, mode: 'chapter',
    }, token, {
      timeoutMs: 600000,
      onEvent: (ev) => {
        if (ev.type === 'novel_created') genNovelId = ev.novelId;
        if (ev.type === 'chapter_end') gotChapter = true;
      }
    });
    const completed = r.events.find(e => e.type === 'completed' || e.type === 'paused' || e.type === 'error');
    createdNovelId = genNovelId;
    report('T1-H 生成单章', gotChapter && completed, { msg: `finalType=${completed?.type}, novelId=${genNovelId}` });
  } catch (e) { report('T1-H 生成单章', false, { error: e.message }); }

  // T1-E "completed 但字数不足" 允许续写
  if (createdNovelId && mongoose.connection.readyState === 1) {
    try {
      await req('POST', `/api/novel/pause/${createdNovelId}`, {}, token);
      const Novel = require('../models/Novel');
      await Novel.updateOne({ _id: createdNovelId }, { $set: { status: 'completed' } });
      const r = await sse(`/api/novel/continue/${createdNovelId}`, { mode: 'chapter' }, token, { timeoutMs: 600000 });
      const chapterEnd = r.events.find(e => e.type === 'chapter_end');
      const errorEvent = r.events.find(e => e.type === 'error');
      const blocked = r.status >= 400;
      report('T1-E completed-字数不足允许续写', !blocked && (chapterEnd || !errorEvent), { msg: `status=${r.status} chapterEnd=${!!chapterEnd} error=${errorEvent?.message || 'none'}` });
    } catch (e) { report('T1-E completed-字数不足允许续写', false, { error: e.message }); }
  } else if (createdNovelId) {
    report('T1-E completed-字数不足允许续写', false, { msg: 'mongoose 未连接，跳过' });
  }

  // T1-F 无章节计划 book 模式自然续写
  if (targetNovelId && mongoose.connection.readyState === 1) {
    try {
      const Novel = require('../models/Novel');
      // 选一个 currentWordCount >= targetWordCount 且无计划的小说，验证自然完成
      const detail = await req('GET', `/api/novel/${targetNovelId}`, null, token);
      const cur = detail.data?.currentWordCount || 0;
      const tgt = detail.data?.targetWordCount || 0;
      if (cur >= tgt) {
        await Novel.updateOne({ _id: targetNovelId }, { $set: { chapterPlanData: null, chapterPlan: '', status: 'paused' } });
        const r = await sse(`/api/novel/continue/${targetNovelId}`, { mode: 'book' }, token, { timeoutMs: 600000 });
        const planEvent = r.events.find(e => e.type === 'plan_needs_extension');
        const chapter = r.events.find(e => e.type === 'chapter_end');
        const completed = r.events.find(e => e.type === 'completed');
        const error = r.events.find(e => e.type === 'error');
        // 期望：不触发 plan_needs_extension，应自然 completed（因为字数已达标）
        report('T1-F 无计划 book 模式自然续写', !planEvent && (completed || chapter) && !error, { msg: `chapterEnd=${!!chapter} completed=${!!completed} planExt=${!!planEvent} error=${error?.message || 'none'}` });
      } else {
        report('T1-F 无计划 book 模式自然续写', false, { msg: `字数未达标 ${cur}/${tgt}，跳过` });
      }
    } catch (e) { report('T1-F 无计划 book 模式自然续写', false, { error: e.message }); }
  }

  // T1-I 旧 /export 路由
  if (targetNovelId) {
    try {
      const r = await req('POST', '/api/novel/export', { novelIds: [targetNovelId] }, token, { parseJson: false });
      const ok = r.status === 200 && (r.headers['content-type'] || '').includes('application/zip');
      report('T1-I 旧 /export 兼容', ok, { msg: `status=${r.status} ct=${r.headers['content-type'] || ''}` });
    } catch (e) { report('T1-I 旧 /export 兼容', false, { error: e.message }); }
  }
}

// ============================================================
// 任务二：润色模块 + 导出验证
// ============================================================
async function taskTwoTests() {
  console.log('\n===== 任务二：润色调优 + 导出验证 =====');

  const sampleText = '陈墨拿起签字笔，仿佛那是一把利剑，宛如战士一般。他嘴角勾起一抹微笑，眉头微蹙地看着那份入职邀请函。空气中弥漫着紧张的气氛，时间仿佛凝固了。他仿佛看见了自己未来的样子，宛如一个胜利者。但事实上，他只是一个实习生，在这个充满勾心斗角的职场中，他需要小心翼翼地生存下去。';

  let polishedText = '';

  // T2-A 润色（含诊断）
  try {
    const r = await sse('/api/novel/polish', { text: sampleText, genre: '都市', diagnose: true }, token, { timeoutMs: 180000 });
    const diag = r.events.find(e => e.type === 'diagnosis');
    const final = r.events.find(e => e.type === 'final_content');
    const completed = r.events.find(e => e.type === 'completed');
    polishedText = final?.content || '';
    report('T2-A 润色（含诊断）', !!final && polishedText.length > 30, {
      msg: `原文 ${sampleText.length} 字 → 润色 ${polishedText.length} 字, diagnosis=${!!diag?.diagnosis}`,
    });
  } catch (e) { report('T2-A 润色（含诊断）', false, { error: e.message }); }

  // T2-B 润色（不含诊断）
  try {
    const r = await sse('/api/novel/polish', { text: sampleText, diagnose: false }, token, { timeoutMs: 180000 });
    const diag = r.events.find(e => e.type === 'diagnosis');
    const final = r.events.find(e => e.type === 'final_content');
    report('T2-B 润色（不含诊断）', !!final && !diag, { msg: `final=${!!final} diagnosis=${!!diag}` });
  } catch (e) { report('T2-B 润色（不含诊断）', false, { error: e.message }); }

  // T2-C 润色（带 genre）
  try {
    const r = await sse('/api/novel/polish', { text: sampleText, genre: '玄幻', diagnose: false }, token, { timeoutMs: 180000 });
    const final = r.events.find(e => e.type === 'final_content');
    report('T2-C 润色（genre=玄幻）', !!final, { msg: `长度=${final?.content?.length}` });
  } catch (e) { report('T2-C 润色（genre=玄幻）', false, { error: e.message }); }

  // T2-D 润色（自定义 prompt，应跳过诊断）
  try {
    const r = await sse('/api/novel/polish', { text: sampleText, polishPrompt: '请将文本精简到 50% 字数。', diagnose: true }, token, { timeoutMs: 180000 });
    const diag = r.events.find(e => e.type === 'diagnosis');
    const final = r.events.find(e => e.type === 'final_content');
    // 自定义 prompt 时，即使 diagnose=true 也应跳过诊断
    report('T2-D 润色（自定义 prompt 跳过诊断）', !!final && !diag, { msg: `final=${!!final} diag=${!!diag}` });
  } catch (e) { report('T2-D 润色（自定义 prompt 跳过诊断）', false, { error: e.message }); }

  // T2-E/F/G 导出
  if (polishedText) {
    for (const fmt of ['txt', 'md']) {
      try {
        const multi = `第1章 初见\n\n${polishedText}\n\n第2章 再见\n\n${polishedText}`;
        const r = await req('POST', '/api/novel/polish-export', { text: multi, title: '测试导出', format: fmt }, token, { parseJson: false });
        const expectedCt = fmt === 'txt' ? 'text/plain' : 'text/markdown';
        const ok = r.status === 200 && (r.headers['content-type'] || '').includes(expectedCt) && r.data.length > 50;
        report(`T2-${fmt === 'txt' ? 'E' : 'F'} 导出 ${fmt.toUpperCase()}`, ok, { msg: `len=${r.data.length} ct=${r.headers['content-type'] || ''}` });
      } catch (e) { report(`T2-${fmt === 'txt' ? 'E' : 'F'} 导出 ${fmt.toUpperCase()}`, false, { error: e.message }); }
    }
    // EPUB
    try {
      const multi = `第1章 初见\n\n${polishedText}\n\n第2章 再见\n\n${polishedText}`;
      const r = await req('POST', '/api/novel/polish-export', { text: multi, title: '测试导出', format: 'epub' }, token, { parseJson: false });
      const magic = r.data.slice(0, 4);
      const isZip = magic === 'PK\x03\x04';
      report('T2-G 导出 EPUB', r.status === 200 && isZip && r.data.length > 100, {
        msg: `len=${r.data.length} magic=${JSON.stringify(magic)} ct=${r.headers['content-type'] || ''}`,
      });
    } catch (e) { report('T2-G 导出 EPUB', false, { error: e.message }); }
  } else {
    report('T2-E/F/G 导出', false, { msg: '无润色文本，跳过' });
  }

  // T2-H 保存回小说（append）
  if (polishedText && targetNovelId) {
    try {
      const before = await req('GET', `/api/novel/${targetNovelId}`, null, token);
      const beforeChapters = (before.data?.chapters || []).length;
      const r = await req('POST', '/api/novel/polish-save', { novelId: targetNovelId, text: polishedText, mode: 'append' }, token);
      const after = await req('GET', `/api/novel/${targetNovelId}`, null, token);
      const afterChapters = (after.data?.chapters || []).length;
      report('T2-H 保存回小说（append）', r.status === 200 && afterChapters === beforeChapters + 1, { msg: `章节 ${beforeChapters} → ${afterChapters}` });
    } catch (e) { report('T2-H 保存回小说（append）', false, { error: e.message }); }
  }

  // T2-I 保存回小说（覆盖指定章节）
  if (polishedText && targetNovelId) {
    try {
      const detail = await req('GET', `/api/novel/${targetNovelId}`, null, token);
      const lastChapter = (detail.data?.chapters || []).slice(-1)[0];
      if (lastChapter) {
        const r = await req('POST', '/api/novel/polish-save', { novelId: targetNovelId, text: polishedText, chapterNumber: lastChapter.chapterNumber }, token);
        const after = await req('GET', `/api/novel/${targetNovelId}`, null, token);
        const newLastChapter = (after.data?.chapters || []).find(c => c.chapterNumber === lastChapter.chapterNumber);
        report('T2-I 保存回小说（覆盖章节）', r.status === 200 && newLastChapter?.content === polishedText.trim(), { msg: `ch${lastChapter.chapterNumber}` });
      } else {
        report('T2-I 保存回小说（覆盖章节）', false, { msg: '无章节' });
      }
    } catch (e) { report('T2-I 保存回小说（覆盖章节）', false, { error: e.message }); }
  }

  // T2-J /deslop 接口（AI 调用可能耗时较久）
  try {
    const r = await req('POST', '/api/novel/deslop', { text: sampleText }, token, { timeoutMs: 180000 });
    report('T2-J /deslop 去 AI 味', r.status === 200 && (r.data?.processed || '').length > 0, { msg: `len=${r.data?.processed?.length || 0}` });
  } catch (e) { report('T2-J /deslop 去 AI 味', false, { error: e.message }); }

  // T2-K /deslop-stream SSE
  try {
    const r = await sse('/api/novel/deslop-stream', { text: sampleText }, token, { timeoutMs: 300000 });
    const completed = r.events.find(e => e.type === 'completed');
    const error = r.events.find(e => e.type === 'error');
    report('T2-K /deslop-stream SSE', !!completed && (completed?.content || '').length > 0 && !error, { msg: `events=${r.events.length} contentLen=${completed?.content?.length || 0}` });
  } catch (e) { report('T2-K /deslop-stream SSE', false, { error: e.message }); }
}

// ============================================================
// 冲突检查
// ============================================================
async function conflictTests() {
  console.log('\n===== 冲突检查 =====');

  // C-A /types
  try {
    const r = await req('GET', '/api/novel/types', null, token);
    report('C-A /api/novel/types', r.status === 200 && Array.isArray(r.data) && r.data.length > 0, { msg: `${r.data?.length} 种` });
  } catch (e) { report('C-A /api/novel/types', false, { error: e.message }); }

  // C-B /generate-outline
  try {
    const r = await req('POST', '/api/novel/generate-outline', { novelTypeId: 'urban', protagonistName: '张三', targetWordCount: 5000 }, token, { timeoutMs: 180000 });
    report('C-B /generate-outline', r.status === 200 && (r.data?.outline || '').length > 0, { msg: `len=${r.data?.outline?.length || 0}` });
  } catch (e) { report('C-B /generate-outline', false, { error: e.message }); }

  // C-C /profile
  try {
    const r = await req('GET', '/api/auth/profile', null, token);
    const email = r.data?.user?.email;
    report('C-C /api/auth/profile', r.status === 200 && !!email, { msg: email || '无 email' });
  } catch (e) { report('C-C /api/auth/profile', false, { error: e.message }); }

  // C-D admin users
  try {
    const r = await req('GET', '/api/admin/users', null, token);
    const ok = r.status === 200 && Array.isArray(r.data?.users);
    if (ok && r.data.users[0]) adminUserId = r.data.users[0]._id;
    report('C-D /api/admin/users', ok, { msg: `${r.data?.users?.length} 用户` });
  } catch (e) { report('C-D /api/admin/users', false, { error: e.message }); }

  // C-E /health
  try {
    const r = await req('GET', '/api/health', null, token);
    report('C-E /api/health', r.status === 200 && r.data?.status === 'ok', { msg: r.data?.status });
  } catch (e) { report('C-E /api/health', false, { error: e.message }); }

  // C-F /export vs /polish-export 共存
  try {
    if (targetNovelId) {
      const r1 = await req('POST', '/api/novel/export', { novelIds: [targetNovelId] }, token, { parseJson: false });
      const r2 = await req('POST', '/api/novel/polish-export', { text: '测试文本' + 'a'.repeat(20), title: 'X', format: 'txt' }, token, { parseJson: false });
      report('C-F /export vs /polish-export 共存', r1.status === 200 && r2.status === 200, { msg: `export=${r1.status} polish-export=${r2.status}` });
    } else {
      report('C-F /export vs /polish-export 共存', false, { msg: '无目标小说' });
    }
  } catch (e) { report('C-F /export vs /polish-export 共存', false, { error: e.message }); }
}

(async () => {
  console.log('========== 任务一 + 任务二 综合回归测试 ==========');
  console.log(`后端: ${BASE} | 客户端: ${CLIENT} | 管理端: ${ADMIN}\n`);

  // 连接 mongoose，以便 T1-F/T1-E 等构造测试数据
  try {
    await mongoose.connect('mongodb://localhost:27017/mirrornovel', { serverSelectionTimeoutMS: 10000 });
    console.log('✅ mongoose 连接成功\n');
  } catch (e) {
    console.warn('⚠️  mongoose 连接失败（部分测试将跳过）:', e.message);
  }

  try {
    await taskOneTests();
    await taskTwoTests();
    await conflictTests();
  } catch (e) {
    console.error('\n❌ 未捕获异常:', e.message);
    issues.push({ name: 'UNCAUGHT', error: e.message });
  }

  try { await mongoose.disconnect(); } catch {}

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n========== 测试汇总 ==========`);
  console.log(`总计: ${results.length} | 通过: ${passed} | 失败: ${failed}`);
  if (issues.length) {
    console.log('\n❌ 失败项详情：');
    for (const i of issues) console.log(`  ${i.name}: ${i.error}`);
  }

  const reportObj = {
    timestamp: new Date().toISOString(),
    summary: { total: results.length, passed, failed },
    results,
    issues,
  };
  try {
    fs.mkdirSync(path.dirname(REPORT), { recursive: true });
    fs.writeFileSync(REPORT, JSON.stringify(reportObj, null, 2), 'utf8');
    console.log(`\n📄 完整报告: ${REPORT}`);
  } catch (e) {
    console.warn('报告落盘失败:', e.message);
  }

  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL:', e); process.exit(2); });
