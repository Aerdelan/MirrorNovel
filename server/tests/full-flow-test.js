/**
 * 全流程调测脚本：覆盖 生成→续写→润色→导出→回存 的完整生命周期，
 * 同时检测并报告系统中的 stuck 状态小说、错误日志、边缘情况。
 *
 * 发现的关键问题：
 *   - BUG-A: 小说状态 stuck "generating" 但后端没有对应的活跃流（服务器重启后未清理）
 *
 * 测试阶段：
 *   PHASE-0  系统健康检查与 stuck 状态检测
 *   PHASE-1  创建新小说 + 完整生成（小目标 8000 字，约 2 章）
 *   PHASE-2  对生成结果续写（book 模式）
 *   PHASE-3  单章续写（chapter 模式）
 *   PHASE-4  润色（含诊断 / 无诊断 / 带 genre / 自定义 prompt）
 *   PHASE-5  导出（TXT / MD / EPUB）
 *   PHASE-6  保存回小说（append + 覆盖）
 *   PHASE-7  清理（删除测试小说）
 *   PHASE-8  stuck 小说的续写行为（验证系统是否能恢复）
 *   PHASE-9  边缘情况：并发续写 / 对 completed 小说续写 / 空文本润色
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const BASE = 'http://localhost:3000';
const REPORT = path.resolve(__dirname, '../../tmp_e2e_report/full-flow-report.json');

const report = {
  startedAt: new Date().toISOString(),
  phases: [],
  issues: [],
  summary: {},
};

function log(phase, msg, ok = null) {
  const entry = { ts: new Date().toISOString(), phase, msg };
  if (ok !== null) entry.ok = ok;
  report.phases.push(entry);
  const mark = ok === null ? '  ' : ok ? '✅' : '❌';
  console.log(`${mark} [${phase}] ${msg}`);
}

function issue(category, severity, description, context = {}) {
  const entry = { ts: new Date().toISOString(), category, severity, description, context };
  report.issues.push(entry);
  console.error(`  ⚠️ [ISSUE ${severity}] ${category}: ${description}`);
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
}

function req(method, urlPath, body, token, { timeoutMs = 30000, parseJson = true } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const r = http.request({
      method, hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
    r.on('timeout', () => { r.destroy(); reject(new Error('request timeout')); });
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

function sse(urlPath, body, token, { timeoutMs = 300000, onEvent, allowNon200 = false } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const r = http.request({
      method: 'POST', hostname: url.hostname, port: url.port, path: url.pathname,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
      timeout: timeoutMs,
    }, (res) => {
      if (res.statusCode >= 400 && !allowNon200) {
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
      res.on('end', () => { clearTimeout(timer); resolve({ status: res.statusCode, events }); });
      res.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('SSE connect timeout')); });
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

// ============================================================
// PHASE-0: 系统健康检查与 stuck 检测
// ============================================================
async function phase0_health(token) {
  console.log('\n===== PHASE-0: 系统健康检查 =====');
  try {
    const health = await req('GET', '/api/health', null, null);
    log('P0-HEALTH', `health status=${health.data?.status}`, health.status === 200 && health.data?.status === 'ok');
  } catch (e) { log('P0-HEALTH', '失败: ' + e.message, false); }

  // 检查所有小说的 status，找出 stuck 状态
  try {
    const books = await req('GET', '/api/novel/bookshelf', null, token);
    const stuck = (books.data || []).filter(b => b.status === 'generating');
    log('P0-STUCK', `书架 ${books.data.length} 本，stuck(generating) ${stuck.length} 本`);
    for (const s of stuck) {
      // 尝试续写：如果 activeStreams 中没有，应该能续写
      try {
        // 用短超时快速检测
        const probe = await new Promise((resolve) => {
          const url = new URL(`/api/novel/continue/${s._id}`, BASE);
          const r = http.request({
            method: 'POST', hostname: url.hostname, port: url.port, path: url.pathname,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            timeout: 5000,
          }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve({ status: res.statusCode, data }));
          });
          r.on('error', () => resolve({ status: 0, data: '' }));
          r.on('timeout', () => { r.destroy(); resolve({ status: 'timeout', data: '' }); });
          r.write(JSON.stringify({ mode: 'chapter' }));
          r.end();
        });
        if (probe.status === 409) {
          log('P0-STUCK', `小说 ${s._id} (${s.currentWordCount}/${s.targetWordCount}) 确实有活跃流`);
        } else if (probe.status === 'timeout') {
          // SSE 已建立，但没返回 409：说明没活跃流，但请求挂着
          // 这是 stuck 状态的迹象
          issue('STUCK_NOVEL', 'WARN', `小说 ${s._id} (${s.title}) status=generating 但无活跃流，可能 orphaned`, { novelId: s._id, currentWordCount: s.currentWordCount, targetWordCount: s.targetWordCount });
        } else {
          log('P0-STUCK', `小说 ${s._id} probe 返回 ${probe.status}: ${probe.data.slice(0, 100)}`);
        }
      } catch (e) {
        log('P0-STUCK', `probe 失败: ${e.message}`, false);
      }
    }
    return { books: books.data || [], stuck };
  } catch (e) { log('P0-STUCK', '失败: ' + e.message, false); return { books: [], stuck: [] }; }
}

// ============================================================
// PHASE-1: 创建新小说 + 完整生成（小目标）
// ============================================================
async function phase1_create(token) {
  console.log('\n===== PHASE-1: 创建新小说并完整生成 =====');
  let novelId = null;
  let chapterCount = 0;
  try {
    const types = await req('GET', '/api/novel/types', null, token);
    const type = types.data?.find(t => t.id === 'urban') || types.data?.[0];
    log('P1-TYPE', `选择类型: ${type.name} (${type.id})`);

    const t0 = Date.now();
    // 使用 20 分钟超时（book 模式包含大纲 + 多章生成）
    const r = await sse('/api/novel/generate', {
      novelTypeId: type.id,
      protagonistName: '调测主角',
      worldSetting: '现代都市，商战背景，测试环境',
      targetWordCount: 8000,
      mode: 'book',
    }, token, {
      timeoutMs: 20 * 60 * 1000,
      onEvent: (ev) => {
        if (ev.type === 'novel_created') novelId = ev.novelId;
        if (ev.type === 'chapter_end') chapterCount++;
        if (ev.type === 'error') issue('P1-GEN', 'ERROR', '生成错误: ' + ev.message, { ev });
      },
    });
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    const completed = r.events.find(e => ['completed', 'paused', 'error', 'plan_needs_extension', 'token_exhausted'].includes(e.type));
    const finalStatus = completed?.type || 'unknown';
    // 任何终止状态均视为生成成功（plan_needs_extension 表示计划执行完毕，paused 表示字数达标或中断）
    const terminalOk = ['completed', 'paused', 'plan_needs_extension'].includes(finalStatus);
    log('P1-GEN', `生成完成: ${dt}s, ${chapterCount} 章, 最终状态=${finalStatus}, novelId=${novelId}`, terminalOk);
  } catch (e) {
    log('P1-GEN', '新建失败: ' + e.message + '，尝试复用现有小说', false);
    issue('P1-GEN', 'WARN', '阶段1生成失败', { error: e.message });
  }

  // 降级：复用现有小说
  if (!novelId) {
    try {
      const books = await req('GET', '/api/novel/bookshelf', null, token);
      const candidate = (books.data || []).find(b => (b.currentWordCount || 0) > 1000 && (b.currentWordCount || 0) < (b.targetWordCount || 0) && b.status !== 'generating');
      if (candidate) {
        novelId = candidate._id;
        log('P1-FALLBACK', `复用小说 ${candidate.title} (${candidate.currentWordCount}/${candidate.targetWordCount})`, true);
      } else {
        log('P1-FALLBACK', '无可复用小说', false);
      }
    } catch (e) { log('P1-FALLBACK', '复用失败: ' + e.message, false); }
  }

  if (novelId) {
    try {
      const detail = await req('GET', `/api/novel/${novelId}`, null, token);
      log('P1-DETAIL', `字数=${detail.data?.currentWordCount}, 章节=${detail.data?.chapters?.length}, 状态=${detail.data?.status}`);
    } catch {}
  }
  return novelId;
}

// ============================================================
// PHASE-2: book 模式续写
// ============================================================
async function phase2_continue_book(token, novelId) {
  console.log('\n===== PHASE-2: book 模式续写 =====');
  if (!novelId) { log('P2-BOOK', '跳过：无小说', false); return; }
  try {
    const t0 = Date.now();
    let chapterCount = 0;
    const r = await sse(`/api/novel/continue/${novelId}`, { mode: 'book' }, token, {
      timeoutMs: 600000,
      onEvent: (ev) => {
        if (ev.type === 'chapter_end') chapterCount++;
        if (ev.type === 'error') issue('P2-BOOK', 'ERROR', '续写错误: ' + ev.message);
      },
    });
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    const completed = r.events.find(e => ['completed', 'paused', 'error', 'plan_needs_extension'].includes(e.type));
    // plan_needs_extension 是正确行为（计划已执行完），视为成功
    const ok = (chapterCount > 0) || completed?.type === 'completed' || completed?.type === 'plan_needs_extension';
    log('P2-BOOK', `完成: ${dt}s, 新增 ${chapterCount} 章, 最终状态=${completed?.type}`, ok);
  } catch (e) { log('P2-BOOK', '失败: ' + e.message, false); issue('P2-BOOK', 'ERROR', '阶段2失败', { error: e.message }); }
}

// ============================================================
// PHASE-3: chapter 模式续写
// ============================================================
async function phase3_continue_chapter(token, novelId) {
  console.log('\n===== PHASE-3: chapter 模式续写 =====');
  if (!novelId) { log('P3-CHAP', '跳过：无小说', false); return; }
  try {
    const t0 = Date.now();
    let chapterCount = 0;
    const r = await sse(`/api/novel/continue/${novelId}`, { mode: 'chapter' }, token, {
      timeoutMs: 600000,
      onEvent: (ev) => {
        if (ev.type === 'chapter_end') chapterCount++;
        if (ev.type === 'error') issue('P3-CHAP', 'ERROR', '续写错误: ' + ev.message);
      },
    });
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    const completed = r.events.find(e => e.type === 'completed' || e.type === 'paused' || e.type === 'error');
    log('P3-CHAP', `完成: ${dt}s, 新增 ${chapterCount} 章, 最终状态=${completed?.type}`, chapterCount === 1);
  } catch (e) { log('P3-CHAP', '失败: ' + e.message, false); issue('P3-CHAP', 'ERROR', '阶段3失败', { error: e.message }); }
}

// ============================================================
// PHASE-4: 润色
// ============================================================
async function phase4_polish(token, novelId) {
  console.log('\n===== PHASE-4: 润色 =====');
  if (!novelId) { log('P4-POL', '跳过：无小说', false); return ''; }
  try {
    const detail = await req('GET', `/api/novel/${novelId}`, null, token);
    const ch1 = detail.data?.chapters?.[0];
    if (!ch1) { log('P4-POL', '跳过：无章节', false); return ''; }
    const sample = ch1.content.slice(0, 800);

    // P4-A 含诊断
    const r1 = await sse('/api/novel/polish', { text: sample, genre: '都市', diagnose: true }, token, { timeoutMs: 300000 });
    const diag = r1.events.find(e => e.type === 'diagnosis');
    const final1 = r1.events.find(e => e.type === 'final_content');
    log('P4-A', `含诊断润色: ${sample.length}→${final1?.content?.length || 0}, diagnosis=${!!diag?.diagnosis}`, !!final1);
    const polishedText = final1?.content || '';

    // P4-B 无诊断
    const r2 = await sse('/api/novel/polish', { text: sample, diagnose: false }, token, { timeoutMs: 300000 });
    log('P4-B', `无诊断润色: ${r2.events.find(e => e.type === 'final_content') ? 'OK' : 'FAIL'}`, !!r2.events.find(e => e.type === 'final_content'));

    // P4-C 带 genre
    const r3 = await sse('/api/novel/polish', { text: sample, genre: '玄幻', diagnose: false }, token, { timeoutMs: 300000 });
    log('P4-C', `玄幻 genre: ${r3.events.find(e => e.type === 'final_content') ? 'OK' : 'FAIL'}`, !!r3.events.find(e => e.type === 'final_content'));

    // P4-D 自定义 prompt
    const r4 = await sse('/api/novel/polish', { text: sample, polishPrompt: '请精简这段文字。', diagnose: true }, token, { timeoutMs: 300000 });
    const diag4 = r4.events.find(e => e.type === 'diagnosis');
    log('P4-D', `自定义 prompt (应跳过诊断): diagnosis=${!!diag4}`, !diag4);

    return polishedText;
  } catch (e) { log('P4-POL', '失败: ' + e.message, false); issue('P4-POL', 'ERROR', '阶段4失败', { error: e.message }); return ''; }
}

// ============================================================
// PHASE-5: 导出
// ============================================================
async function phase5_export(token, polishedText) {
  console.log('\n===== PHASE-5: 导出 =====');
  if (!polishedText) { log('P5-EXP', '跳过：无润色文本', false); return; }
  const multi = `第1章 初见\n\n${polishedText}\n\n第2章 再见\n\n${polishedText}`;
  for (const fmt of ['txt', 'md', 'epub']) {
    try {
      const r = await req('POST', '/api/novel/polish-export', { text: multi, title: '调测导出', format: fmt }, token, { parseJson: false });
      const ct = r.headers['content-type'] || '';
      let ok = r.status === 200;
      if (fmt === 'epub') {
        const magic = r.data.slice(0, 4);
        ok = ok && magic === 'PK\x03\x04';
      }
      log(`P5-${fmt.toUpperCase()}`, `status=${r.status} len=${r.data.length} ct=${ct}`, ok);
    } catch (e) { log(`P5-${fmt.toUpperCase()}`, '失败: ' + e.message, false); issue(`P5-${fmt.toUpperCase()}`, 'ERROR', '导出失败', { error: e.message }); }
  }
}

// ============================================================
// PHASE-6: 保存回小说
// ============================================================
async function phase6_save(token, novelId, polishedText) {
  console.log('\n===== PHASE-6: 保存回小说 =====');
  if (!novelId || !polishedText) { log('P6-SAVE', '跳过', false); return; }
  try {
    // append
    const before = await req('GET', `/api/novel/${novelId}`, null, token);
    const r = await req('POST', '/api/novel/polish-save', { novelId, text: polishedText, mode: 'append' }, token);
    const after = await req('GET', `/api/novel/${novelId}`, null, token);
    const beforeCount = before.data?.chapters?.length || 0;
    const afterCount = after.data?.chapters?.length || 0;
    log('P6-APPEND', `章节 ${beforeCount} → ${afterCount}`, afterCount === beforeCount + 1);

    // 覆盖最后一章
    const lastCh = after.data?.chapters?.slice(-1)[0];
    if (lastCh) {
      const r2 = await req('POST', '/api/novel/polish-save', { novelId, text: polishedText, chapterNumber: lastCh.chapterNumber }, token);
      log('P6-OVERWRITE', `覆盖 ch${lastCh.chapterNumber}: status=${r2.status}`, r2.status === 200);
    }
  } catch (e) { log('P6-SAVE', '失败: ' + e.message, false); issue('P6-SAVE', 'ERROR', '阶段6失败', { error: e.message }); }
}

// ============================================================
// PHASE-7: 清理
// ============================================================
async function phase7_cleanup(token, novelId) {
  console.log('\n===== PHASE-7: 清理 =====');
  if (!novelId) { log('P7-CLEAN', '跳过', false); return; }
  try {
    // 当前系统没有 delete 接口，直接通过 mongoose 删除
    const Novel = require('../models/Novel');
    const result = await Novel.deleteOne({ _id: novelId });
    log('P7-CLEAN', `已删除 ${novelId} (deletedCount=${result.deletedCount})`, result.deletedCount === 1);
  } catch (e) { log('P7-CLEAN', '删除失败: ' + e.message, false); }
}

// ============================================================
// PHASE-8: stuck 小说续写行为
// ============================================================
async function phase8_stuck(token, stuckNovels) {
  console.log('\n===== PHASE-8: stuck 小说续写行为 =====');
  if (!stuckNovels.length) { log('P8-STUCK', '无 stuck 小说', true); return; }
  for (const s of stuckNovels.slice(0, 2)) {
    try {
      const t0 = Date.now();
      let chapterCount = 0;
      const r = await sse(`/api/novel/continue/${s._id}`, { mode: 'chapter' }, token, {
        timeoutMs: 300000,
        onEvent: (ev) => {
          if (ev.type === 'chapter_end') chapterCount++;
          if (ev.type === 'error') issue('P8-STUCK', 'ERROR', `stuck 续写错误: ${ev.message}`, { novelId: s._id });
        },
      });
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      const completed = r.events.find(e => e.type === 'completed' || e.type === 'paused' || e.type === 'error');
      const conflict = r.status === 409;
      log('P8-STUCK', `小说 ${s._id} (${s.currentWordCount}/${s.targetWordCount}): ${conflict ? '有活跃流' : `续写 ${dt}s ${chapterCount} 章 final=${completed?.type}`}`, chapterCount > 0 || conflict);
    } catch (e) { log('P8-STUCK', `小说 ${s._id} 失败: ${e.message}`, false); }
  }
}

// ============================================================
// PHASE-9: 边缘情况
// ============================================================
async function phase9_edge(token, novelId) {
  console.log('\n===== PHASE-9: 边缘情况 =====');

  // P9-A 空文本润色
  try {
    const r = await req('POST', '/api/novel/polish', { text: '' }, token);
    log('P9-EMPTY', `空文本润色 status=${r.status} (应为 400)`, r.status === 400);
  } catch (e) { log('P9-EMPTY', '失败: ' + e.message, false); }

  // P9-B 极短文本润色（<10 字应返回 400）
  try {
    const r = await sse('/api/novel/polish', { text: '短文本', diagnose: true }, token, { timeoutMs: 60000, allowNon200: true });
    log('P9-SHORT', `短文本润色: status=${r.status} (应为 400)`, r.status === 400);
  } catch (e) { log('P9-SHORT', '失败: ' + e.message, false); }

  // P9-C 导出空文本
  try {
    const r = await req('POST', '/api/novel/polish-export', { text: '', format: 'txt' }, token);
    log('P9-EMPTY-EXP', `空文本导出 status=${r.status} (应为 400)`, r.status === 400);
  } catch (e) { log('P9-EMPTY-EXP', '失败: ' + e.message, false); }

  // P9-D 保存不存在的小说（文本需 ≥10 字以通过长度校验）
  try {
    const r = await req('POST', '/api/novel/polish-save', { novelId: '000000000000000000000000', text: '这是一段超过十个字的测试文本', mode: 'append' }, token);
    log('P9-MISSING', `保存不存在小说 status=${r.status} (应为 404)`, r.status === 404);
  } catch (e) { log('P9-MISSING', '失败: ' + e.message, false); }

  // P9-E 重复续写（并发）
  if (novelId) {
    try {
      // 第一次续写（正常开始）
      const firstStart = sse(`/api/novel/continue/${novelId}`, { mode: 'chapter' }, token, { timeoutMs: 300000 });
      // 等待 2 秒后第二次续写（应返回 409）
      await new Promise(r => setTimeout(r, 2000));
      const probe = await req('POST', `/api/novel/continue/${novelId}`, { mode: 'chapter' }, token, { timeoutMs: 5000 });
      const conflict = probe.status === 409;
      log('P9-CONCURRENT', `并发续写: 第二次 status=${probe.status} (应为 409)`, conflict);
      // 等待第一次完成
      await firstStart.catch(() => {});
    } catch (e) { log('P9-CONCURRENT', '失败: ' + e.message, false); }
  }
}

// ============================================================
// 主流程
// ============================================================
(async () => {
  console.log('========== 全流程调测 ==========');
  console.log(`后端: ${BASE}`);
  console.log(`报告: ${REPORT}\n`);

  await mongoose.connect('mongodb://localhost:27017/mirrornovel', { serverSelectionTimeoutMS: 10000 });
  console.log('✅ mongoose 连接成功');

  // 登录
  const login = await req('POST', '/api/auth/login', { email: 'admin@xiaoshuo.com', password: 'admin888' });
  const token = login.data.token;
  console.log(`✅ 登录成功: ${login.data.user?.email}\n`);

  let novelId = null;
  let polishedText = '';
  let stuckNovels = [];

  try {
    // PHASE-0
    const phase0Result = await phase0_health(token);
    stuckNovels = phase0Result.stuck;

    // PHASE-1
    novelId = await phase1_create(token);

    // PHASE-2/3
    await phase2_continue_book(token, novelId);
    await phase3_continue_chapter(token, novelId);

    // PHASE-4/5/6
    polishedText = await phase4_polish(token, novelId);
    await phase5_export(token, polishedText);
    await phase6_save(token, novelId, polishedText);

    // PHASE-7
    await phase7_cleanup(token, novelId);

    // PHASE-8
    await phase8_stuck(token, stuckNovels);

    // PHASE-9
    await phase9_edge(token, novelId);
  } catch (e) {
    console.error('\n❌ 未捕获异常:', e.message, e.stack);
    issue('UNCAUGHT', 'FATAL', e.message, { stack: e.stack });
  }

  try { await mongoose.disconnect(); } catch {}

  // 汇总
  const phases = report.phases.filter(p => p.ok !== undefined);
  const passed = phases.filter(p => p.ok).length;
  const failed = phases.filter(p => !p.ok).length;
  report.summary = {
    total: phases.length, passed, failed,
    issueCount: report.issues.length,
    novelId,
    stuckCount: stuckNovels.length,
    endedAt: new Date().toISOString(),
    durationMin: ((new Date(report.endedAt || Date.now()) - new Date(report.startedAt)) / 60000).toFixed(1),
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');

  console.log('\n========== 调测汇总 ==========');
  console.log(`阶段总数: ${phases.length} | 通过: ${passed} | 失败: ${failed}`);
  console.log(`发现问题: ${report.issues.length} 个`);
  console.log(`耗时: ${report.summary.durationMin} 分钟`);
  console.log(`📄 完整报告: ${REPORT}`);

  process.exit(failed === 0 && report.issues.length === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL:', e); process.exit(2); });
