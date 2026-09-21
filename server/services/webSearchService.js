/**
 * 联网取材服务（Web Research）。
 *
 * 职责：把"题材/世界观 + 用户粘贴链接"变成一段可注入系统提示的资料块（researchBlock）
 * 及来源列表。设计要点：
 *  - 搜索源可插拔（Tavily / Serper / Brave / none），服务器在海外默认走 Tavily；
 *  - 正文抓取先走全局 fetch（快、轻），JS 渲染页回退 Playwright（项目既有依赖）；
 *  - 结果用模型浓缩为要点（completeOnce），失败/无线路时退回直接用检索摘要；
 *  - 带 TTL 缓存与规模上限；任何异常都降级返回空，绝不阻断生成主流程。
 */
const { getWebSearchConfig } = require('../config/webSearch');

// ===== 轻量 TTL 缓存（仿 aiService 的 providerTokenCapCache）=====
const cache = new Map();
function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expire) { cache.delete(key); return null; }
  return hit.value;
}
function cacheSet(key, value, ttlMs) {
  if (cache.size >= 200) cache.delete(cache.keys().next().value);
  cache.set(key, { value, expire: Date.now() + (ttlMs || 6 * 60 * 60 * 1000) });
}
function _clearCache() { cache.clear(); }

// ===== HTML → 正文 =====
const ENTITY_MAP = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&mdash;': '—', '&ldquo;': '“', '&rdquo;': '”', '&hellip;': '…' };
function decodeEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ''; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch { return ''; } })
    .replace(/&[a-z]+;/gi, (m) => ENTITY_MAP[m.toLowerCase()] || m);
}
function extractReadableText(html) {
  if (!html) return '';
  let t = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  t = decodeEntities(t).replace(/\r/g, '');
  // 折叠空白：行内多空格→单空格，多余空行→最多一个空行
  t = t.split('\n').map((line) => line.replace(/[ \t\u3000]+/g, ' ').trim()).filter(Boolean).join('\n');
  return t.replace(/\n{3,}/g, '\n\n').trim();
}
function extractTitle(html) {
  const m = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim().slice(0, 120) : '';
}

// ===== HTTP 抓取 =====
function withTimeout(signalFactory, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => { try { controller.abort(); } catch {} }, ms);
  if (typeof signalFactory === 'function') signalFactory(controller);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

async function httpGetText(url, timeoutMs) {
  const { signal, done } = withTimeout(null, timeoutMs);
  try {
    const res = await fetch(url, {
      signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } finally { done(); }
}

// Playwright 回退（惰性、进程内复用一个浏览器；仅对 JS 渲染页触发）
let pwBrowser = null;
let pwIdleTimer = null;
async function playwrightGetText(url, timeoutMs) {
  const { chromium } = require('playwright');
  if (!pwBrowser || !pwBrowser.isConnected()) {
    pwBrowser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  }
  if (pwIdleTimer) clearTimeout(pwIdleTimer);
  const context = await pwBrowser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    locale: 'zh-CN', viewport: { width: 1280, height: 900 },
  });
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForTimeout(1200);
    const title = await page.title().catch(() => '');
    const text = await page.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
    return { title, text: String(text || '') };
  } finally {
    await context.close().catch(() => {});
    // 空闲 60s 后关闭浏览器，避免常驻
    pwIdleTimer = setTimeout(() => { if (pwBrowser) { pwBrowser.close().catch(() => {}); pwBrowser = null; } }, 60000);
  }
}

function normalizeUrl(u) {
  const s = String(u || '').trim();
  if (!/^https?:\/\//i.test(s)) return '';
  return s;
}

async function fetchUrlContent(url, cfg = getWebSearchConfig(), timeoutMs = 15000) {
  const clean = normalizeUrl(url);
  if (!clean) return { url: clean, title: '', text: '' };
  const ck = `u:${clean}`;
  const cached = cacheGet(ck);
  if (cached) return cached;
  let title = '';
  let text = '';
  // 1) 先走轻量 fetch
  try {
    const { body } = await httpGetText(clean, timeoutMs);
    title = extractTitle(body);
    text = extractReadableText(body);
  } catch (e) {
    text = '';
  }
  // 2) 正文过短（大概率 JS 渲染）→ Playwright 回退
  if (text.length < 200) {
    try {
      const pw = await playwrightGetText(clean, timeoutMs);
      if (pw.text && pw.text.length > text.length) { text = extractReadableText(pw.text); if (!title) title = pw.title; }
    } catch (e) { /* 回退失败则沿用 fetch 结果 */ }
  }
  const result = { url: clean, title: title || clean, text: text.slice(0, cfg.perPageChars || 4000) };
  cacheSet(ck, result, cfg.cacheTtlMs);
  return result;
}

// ===== 搜索源 =====
async function callTavily(query, apiKey, maxResults) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, search_depth: 'basic', max_results: maxResults, include_answer: false }),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}`);
  const data = await res.json();
  return (data.results || []).map((r) => ({ title: r.title, url: r.url, snippet: r.content }));
}
async function callSerper(query, apiKey, maxResults) {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
    body: JSON.stringify({ q: query, num: maxResults, hl: 'zh-cn' }),
  });
  if (!res.ok) throw new Error(`Serper ${res.status}`);
  const data = await res.json();
  return (data.organic || []).slice(0, maxResults).map((r) => ({ title: r.title, url: r.link, snippet: r.snippet }));
}
async function callBrave(query, apiKey, maxResults) {
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`, {
    headers: { 'X-Subscription-Token': apiKey, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Brave ${res.status}`);
  const data = await res.json();
  return (data.web?.results || []).slice(0, maxResults).map((r) => ({ title: r.title, url: r.url, snippet: r.description }));
}

async function searchWeb(query, cfg = getWebSearchConfig(), { maxResults = 5 } = {}) {
  if (!query) return [];
  if (cfg.provider === 'none' || !cfg.apiKey) return [];
  const ck = `s:${cfg.provider}:${query}`;
  const cached = cacheGet(ck);
  if (cached) return cached;
  let results = [];
  try {
    if (cfg.provider === 'tavily') results = await callTavily(query, cfg.apiKey, maxResults);
    else if (cfg.provider === 'serper') results = await callSerper(query, cfg.apiKey, maxResults);
    else if (cfg.provider === 'brave') results = await callBrave(query, cfg.apiKey, maxResults);
  } catch (e) {
    console.warn(`[WebSearch] searchWeb(${cfg.provider}) 失败:`, e.message);
    return [];
  }
  const cleaned = (results || []).filter((r) => r && normalizeUrl(r.url)).map((r) => ({ title: String(r.title || '').trim(), url: r.url.trim(), snippet: String(r.snippet || '').trim() }));
  cacheSet(ck, cleaned, cfg.cacheTtlMs);
  return cleaned;
}

// ===== 检索词派生 =====
function deriveQueries({ typeName, protagonistName, worldSetting } = {}, maxQueries = 4) {
  const queries = [];
  const ws = String(worldSetting || '').replace(/\s+/g, ' ').trim();
  const type = String(typeName || '').trim();
  const push = (q) => { const s = String(q || '').replace(/\s+/g, ' ').trim(); if (s && !queries.includes(s)) queries.push(s); };
  // 世界观前 60 字往往信息密度最高，直接作为一条精确检索
  if (ws) push(ws.slice(0, 60));
  if (type) {
    push(`${type} 背景 设定 真实 考据`);
    push(`${type} 常识 细节`);
  }
  // 从世界观里再挑几个短词组补充（按标点切分取前若干段）
  if (ws) {
    for (const seg of ws.split(/[，。、,.;；]/).map((s) => s.trim()).filter((s) => s.length >= 2 && s.length <= 16)) {
      push(seg);
      if (queries.length >= maxQueries) break;
    }
  }
  if (protagonistName && queries.length < maxQueries) push(`${protagonistName} ${type}`.trim());
  return queries.slice(0, maxQueries);
}

// ===== 资料浓缩 =====
const SUMMARIZE_SYSTEM = '你是小说创作的资料研究员。把检索到的网页资料浓缩成与本书题材相关的客观事实要点，只保留可支撑情节设定的信息。';
function buildSummarizePrompt(material, context) {
  return `${context ? `本书背景：${context}

` : ''}以下是联网检索到的资料原文片段：

${material}

请提炼为不超过 12 条的中文事实要点：
- 每条一行，以「- 」开头，句末用「（来源N）」标注来源编号；
- 只写客观事实/背景/流程/常识，不写观点；
- 与本书题材无关的内容直接丢弃；
- 不要照搬原句，用自己的话概述。
直接输出要点列表，不要额外解释。`;
}

function normalizeLinks(links) {
  const arr = Array.isArray(links) ? links : String(links || '').split(/[\n,，]/);
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const u = normalizeUrl(item);
    if (u && !seen.has(u)) { seen.add(u); out.push(u); }
  }
  return out;
}

/**
 * 采集资料并生成可注入的资料块。
 * @returns {Promise<{block:string, sources:Array<{title:string,url:string}>, skipped:boolean, note?:string}>}
 */
async function gatherResearch({ type, protagonistName, worldSetting, links, apiConfig, cfg = getWebSearchConfig() } = {}) {
  const startedAt = Date.now();
  const deadline = startedAt + (cfg.stepTimeoutMs || 45000);
  try {
    const userLinks = normalizeLinks(links).slice(0, cfg.maxUserUrls || 6);
    const canSearch = cfg.provider !== 'none' && !!cfg.apiKey;
    const queries = canSearch ? deriveQueries({ typeName: type, protagonistName, worldSetting }, cfg.maxQueries || 4) : [];

    // 1) 检索 → 收集候选页面（用户链接优先，且始终抓取）
    const candidateUrls = [];
    const seenUrl = new Set();
    const snippets = [];
    for (const u of userLinks) { if (!seenUrl.has(u)) { seenUrl.add(u); candidateUrls.push({ url: u, fromUser: true }); } }
    for (const q of queries) {
      if (Date.now() > deadline) break;
      const results = await searchWeb(q, cfg, { maxResults: 5 });
      for (const r of results) {
        if (r.snippet) snippets.push({ url: r.url, title: r.title, snippet: r.snippet });
        if (!seenUrl.has(r.url) && candidateUrls.filter((c) => !c.fromUser).length < (cfg.maxAutoUrls || 3)) {
          seenUrl.add(r.url); candidateUrls.push({ url: r.url, fromUser: false });
        }
      }
    }

    // 2) 抓取正文
    const pages = [];
    for (const c of candidateUrls) {
      if (Date.now() > deadline) break;
      const content = await fetchUrlContent(c.url, cfg);
      if (content.text && content.text.length >= 80) pages.push({ ...content, fromUser: c.fromUser });
    }

    if (!pages.length && !snippets.length) {
      return { block: '', sources: [], skipped: true, note: canSearch || userLinks.length ? '未获取到有效资料' : '未启用联网取材' };
    }

    // 3) 组装来源编号 + 原始素材
    const sources = [];
    const sourceIndex = new Map();
    const ensureSource = (url, title) => {
      const key = url;
      if (sourceIndex.has(key)) return sourceIndex.get(key);
      const n = sources.length + 1;
      sources.push({ title: title || url, url });
      sourceIndex.set(key, n);
      return n;
    };
    let material = '';
    for (const p of pages) {
      const n = ensureSource(p.url, p.title);
      material += `\n[来源${n}] ${p.title}\nURL: ${p.url}\n${p.text.slice(0, 1500)}\n`;
    }
    for (const s of snippets) {
      if (sourceIndex.has(s.url)) continue; // 已作为整页收录，避免重复
      const n = ensureSource(s.url, s.title);
      material += `\n[来源${n}] ${s.title}\nURL: ${s.url}\n${s.snippet}\n`;
    }
    material = material.slice(0, 12000);

    // 4) 浓缩为要点（失败则退回直接使用素材片段）
    let bullets = '';
    try {
      bullets = await require('./aiService').completeOnce(
        SUMMARIZE_SYSTEM,
        buildSummarizePrompt(material, type ? `${type}` : ''),
        apiConfig,
        { temperature: 0.3, maxTokens: 1024, timeoutMs: Math.max(15000, deadline - Date.now()) },
      );
    } catch (e) {
      console.warn('[WebSearch] 资料浓缩失败，退回原始摘要:', e.message);
    }
    if (!bullets || bullets.trim().length < 20) {
      // 兜底：把检索摘要直接整理成要点
      bullets = snippets.slice(0, 10).map((s) => {
        const n = ensureSource(s.url, s.title);
        return `- ${s.snippet.slice(0, 160)}（来源${n}）`;
      }).join('\n');
    }

    // 5) 拼资料块并限长
    const sourceLines = sources.map((s, i) => `[${i + 1}] ${s.title} - ${s.url}`).join('\n');
    let block = [
      '【联网取材参考 — 实时检索到的公开资料，仅供事实参考】',
      bullets.trim(),
      '',
      '来源列表：',
      sourceLines,
      '',
      '使用约束：以上仅为背景事实参考；与本书已确立的设定、人物、因果冲突时，一律以本书设定为准；不得照搬原文句子（避免侵权）；不确定的信息不要写成断言，可用"据公开资料"等模糊表述。',
    ].join('\n');
    const cap = (cfg.blockTokenCap || 2500) * 2; // 粗略：中文按 ~1.5 字/token，留冗余用 2 倍
    if (block.length > cap) block = block.slice(0, cap) + '\n…（资料过长已截断）';

    return { block, sources, skipped: false };
  } catch (e) {
    console.error('[WebSearch] gatherResearch 异常，降级跳过:', e.message);
    return { block: '', sources: [], skipped: true, note: e.message };
  }
}

module.exports = {
  gatherResearch,
  searchWeb,
  fetchUrlContent,
  deriveQueries,
  normalizeLinks,
  extractReadableText,
  _clearCache,
};
