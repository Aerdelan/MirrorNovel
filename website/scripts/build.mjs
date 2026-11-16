import { readFile, writeFile, mkdir, cp, rm, readdir, stat } from 'node:fs/promises';
import { resolve, dirname, sep, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { pages } from '../src/content.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist');
if (!out.startsWith(root + sep) || out !== join(root, 'dist')) throw new Error('Unsafe build output');
const config = JSON.parse(await readFile(join(root, 'site.config.json'), 'utf8'));
const origin = new URL(process.env.SITE_URL || config.origin);
if (!['http:', 'https:'].includes(origin.protocol) || origin.pathname !== '/' || origin.username || origin.password || origin.search || origin.hash) throw new Error('SITE_URL must be an HTTP(S) origin without a path');
config.origin = origin.origin;
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const absolute = path => new URL(path, config.origin).href;
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(join(root, 'public'), out, { recursive: true });

const assets = {};
for (const [key, filename] of [['css', 'site.css'], ['js', 'site.js']]) {
  let contents = await readFile(join(root, 'src', filename), 'utf8');
  if (key === 'css') contents += '\n' + await readFile(join(root, 'src', 'content.css'), 'utf8');
  const hash = createHash('sha256').update(contents).digest('hex').slice(0, 12);
  assets[key] = `/assets/site.${hash}.${key}`;
  await writeFile(join(out, assets[key]), contents);
}
const shots = {
  create: ['题材与人设', 'MirrorNovel 桌面端：选择小说类型、情节元素、人设标签与写作风格', 1920, 1080],
  style: ['写作风格', 'MirrorNovel 写作风格：题材标签与可复用的个人风格模板', 1920, 1080],
  polish: ['文本润色', 'MirrorNovel 润色界面：输入文字、设置润色方案、自定义要求与文风类型', 1920, 1080],
  models: ['模型线路', 'MirrorNovel 模型线路配置：个人接口、默认模型与四类任务分配', 1920, 1080],
  bookshelf: ['我的书架', 'MirrorNovel 书架：集中管理小说、查看生成进度、续写与导出', 1920, 1080],
  outline: ['AI 大纲预览', 'MirrorNovel 大纲确认：编辑故事主线与阶段性目标，再开始生成正文', 1320, 1068],
  continue: ['小说续写', 'MirrorNovel 小说续写：输入或上传已有正文，配置续写方向与字数', 1320, 1068]
};
// Use the source dimensions rather than assuming all historic screenshots share a size.
for (const [key, shot] of Object.entries(shots)) {
  const buffer = await readFile(join(root, 'public', 'assets', `${key}.png`));
  shot[2] = buffer.readUInt32BE(16);
  shot[3] = buffer.readUInt32BE(20);
}
function screenshot(key, hero = false) {
  const [label, alt, width, height] = shots[key];
  const widths = [768, 1280, 1920].filter(size => size <= width);
  const fallback = widths.includes(1280) ? 1280 : widths.at(-1);
  return `<a class="shot" href="/assets/${key}.png" data-full="/assets/${key}.png" data-label="${esc(label)}" aria-label="放大${esc(label)}截图"><img src="/assets/${key}-${fallback}.webp" srcset="${widths.map(size => `/assets/${key}-${size}.webp ${size}w`).join(', ')}" sizes="${hero ? '(max-width:760px) calc(100vw - 36px), (max-width:1276px) calc(100vw - 96px), 1180px' : '(max-width:760px) calc(100vw - 36px), (max-width:1276px) 65vw, 1000px'}" width="${width}" height="${height}" alt="${esc(alt)}" ${hero ? 'fetchpriority="high" loading="eager"' : 'loading="lazy"'} decoding="async"></a>`;
}
const download = `<a class="download" href="${esc(config.release.url)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5"/></svg>免费下载 Windows 版</a>`;
function tokens(html) {
  return html.replace(/\{\{shot:([a-z]+)(:hero)?\}\}/g, (_, key, hero) => screenshot(key, Boolean(hero)))
    .replaceAll('{{download}}', download).replaceAll('{{repository}}', esc(config.repository)).replaceAll('{{author}}', esc(config.author))
    .replaceAll('{{version}}', esc(config.release.version)).replaceAll('{{tag}}', esc(config.release.tag)).replaceAll('{{filename}}', esc(config.release.file));
}
function header() {
  return `<a class="skip-link" href="#main">跳到正文</a><header class="wrap"><a class="brand" href="/" aria-label="MirrorNovel 首页"><img src="/assets/logo.png" alt="" width="34" height="34"><span>MirrorNovel</span></a><nav aria-label="主导航"><a href="/#preview">软件预览</a><a href="/#models">模型接入</a><a href="/docs/">使用指南</a><a href="${config.author}" target="_blank" rel="noopener">联系作者 ↗</a></nav></header>`;
}
function footer() {
  return `<footer class="wrap footer"><div class="footer-top"><a class="brand" href="/"><img src="/assets/logo.png" alt="" width="29" height="29"><span>MirrorNovel</span></a><div class="footer-links"><a href="/download/">下载安装</a><a href="/docs/">使用指南</a><a href="${config.repository}/releases" target="_blank" rel="noopener">版本记录 ↗</a><a href="${config.author}" target="_blank" rel="noopener">联系作者 ↗</a></div></div><div class="footer-bottom"><span>免费开源的 AI 创作工作台</span><a href="${config.repository}/blob/main/LICENSE" target="_blank" rel="noopener">AGPL-3.0-only</a></div></footer>`;
}
function dialog() {
  return `<dialog class="dialog" id="image-dialog" aria-labelledby="dialog-title"><div class="dialog-bar"><div class="dialog-title"><span id="dialog-title">软件截图</span><a id="original-link" href="/assets/create.png" target="_blank" rel="noopener">查看原图 ↗</a></div><button id="close-dialog" type="button" autofocus>关闭 ×</button></div><img id="dialog-image" width="1920" height="1080" alt="软件界面大图"></dialog>`;
}
function layout(page, body, noindex = false) {
  const url = absolute(page.path);
  const graph = [
    { '@type': 'WebSite', '@id': absolute('/#website'), name: config.name, url: absolute('/'), inLanguage: 'zh-CN' },
    { '@type': 'WebPage', '@id': `${url}#webpage`, name: page.title, description: page.description, url, inLanguage: 'zh-CN', isPartOf: { '@id': absolute('/#website') } }
  ];
  if (page.path === '/') graph.push({ '@type': 'SoftwareApplication', '@id': absolute('/#software'), name: config.name, applicationCategory: 'ProductivityApplication', operatingSystem: 'Windows 64-bit', softwareVersion: config.release.version, description: page.description, url, downloadUrl: config.release.url, image: absolute('/assets/create.png'), isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', url: absolute('/download/') }, author: { '@type': 'Person', name: 'Aerdelan', url: config.author, sameAs: config.author }, license: `${config.repository}/blob/main/LICENSE` });
  if (page.path !== '/' && !noindex) {
    const crumbs = [{ '@type': 'ListItem', position: 1, name: '首页', item: absolute('/') }];
    if (page.path !== '/docs/' && page.path !== '/download/') crumbs.push({ '@type': 'ListItem', position: 2, name: '使用指南', item: absolute('/docs/') });
    crumbs.push({ '@type': 'ListItem', position: crumbs.length + 1, name: page.title, item: url });
    graph.push({ '@type': 'BreadcrumbList', itemListElement: crumbs });
  }
  const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replaceAll('<', '\\u003c');
  return `<!doctype html>\n<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(page.title)}</title><meta name="description" content="${esc(page.description)}"><meta name="robots" content="${noindex ? 'noindex,follow' : 'index,follow,max-image-preview:large'}"><link rel="canonical" href="${esc(url)}"><meta name="theme-color" content="#2f8064"><meta property="og:type" content="website"><meta property="og:locale" content="zh_CN"><meta property="og:site_name" content="MirrorNovel"><meta property="og:title" content="${esc(page.title)}"><meta property="og:description" content="${esc(page.description)}"><meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${absolute('/assets/create.png')}"><meta property="og:image:width" content="1920"><meta property="og:image:height" content="1080"><meta property="og:image:alt" content="MirrorNovel 桌面创作工作台真实界面"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(page.title)}"><meta name="twitter:description" content="${esc(page.description)}"><meta name="twitter:image" content="${absolute('/assets/create.png')}"><link rel="icon" href="/assets/favicon.png" type="image/png"><link rel="apple-touch-icon" href="/assets/apple-touch-icon.png"><link rel="stylesheet" href="${assets.css}"><script type="application/ld+json">${json}</script><script src="${assets.js}" defer></script></head><body>${header()}${body}${footer()}${dialog()}</body></html>`;
}
const homepage = { path: '/', title: 'MirrorNovel - 免费开源 AI 小说写作软件与桌面创作工作台', description: 'MirrorNovel 是面向小说与短剧创作者的免费开源 AI 桌面工作台，支持故事蓝图、小说续写、风格模板与润色修订。可接入个人模型，也可联系作者提供模型，支持自建后端与拓展，免费下载 Windows 版。' };
let home = tokens(await readFile(join(root, 'src', 'home.html'), 'utf8')).replace('id="top"', 'id="main"');
await writeFile(join(out, 'index.html'), layout(homepage, home));
for (const page of pages) {
  const shortTitle = page.title.split(/[：:]/)[0].replace(/^MirrorNovel\s*/, '');
  const breadcrumbs = `<nav class="breadcrumbs" aria-label="面包屑"><a href="/">首页</a><span>/</span>${page.path !== '/docs/' && page.path !== '/download/' ? '<a href="/docs/">使用指南</a><span>/</span>' : ''}<span aria-current="page">${esc(shortTitle)}</span></nav>`;
  const main = `<main id="main" class="wrap article-wrap">${breadcrumbs}<article class="article"><div class="article-heading"><span class="eyebrow">${esc(page.section)}</span><h1>${esc(page.title)}</h1><p class="article-intro">${esc(page.intro)}</p><p class="updated">内容更新于 <time datetime="${config.updated}">${config.updated}</time></p></div><div class="article-body">${tokens(page.body)}</div></article></main>`;
  const target = join(out, page.path, 'index.html');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, layout(page, main));
}
const notFound = { path: '/404.html', title: '页面未找到 - MirrorNovel', description: '这个页面暂时不存在，返回 MirrorNovel 首页或查看使用指南。' };
await writeFile(join(out, '404.html'), layout(notFound, '<main id="main" class="wrap error-page"><span class="eyebrow">404</span><h1>这页故事，还没写到。</h1><p>地址可能已变更，试试从首页或使用指南继续。</p><div class="actions"><a class="download" href="/">返回首页</a><a class="text-link" href="/docs/">查看使用指南 →</a></div></main>', true));
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[homepage, ...pages].map(page => `<url><loc>${esc(absolute(page.path))}</loc><lastmod>${config.updated}</lastmod></url>`).join('')}</urlset>\n`;
await writeFile(join(out, 'sitemap.xml'), sitemap);
await writeFile(join(out, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${absolute('/sitemap.xml')}\n`);
await writeFile(join(out, '_headers'), `/assets/*\n  Cache-Control: public, max-age=86400\n  X-Content-Type-Options: nosniff\n/assets/site.*\n  Cache-Control: public, max-age=31536000, immutable\n/*\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n`);
await writeFile(join(out, '_redirects'), '/* /404.html 404\n');
let total = 0;
async function bytes(dir) { for (const entry of await readdir(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) await bytes(path); else total += (await stat(path)).size; } }
await bytes(out);
console.log(`Built ${pages.length + 1} indexable pages and 404 · ${(total / 1024 / 1024).toFixed(2)} MB · ${config.origin}`);
