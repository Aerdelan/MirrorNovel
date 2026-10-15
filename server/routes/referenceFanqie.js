const express = require('express');
const auth = require('../middleware/auth');
const scraper = require('../services/fanqieScraper');
const fanqieAuth = require('../services/fanqieAuth');
const ReferenceNovel = require('../models/ReferenceNovel');
const router = express.Router();
router.use((req, res, next) => {
  if (!req.path.startsWith('/fanqie-')) return next();
  return auth(req, res, () => req.user.role === 'admin' ? next() : res.status(403).json({ message: '网页下载与服务器 Cookie 管理仅限管理员' }));
});
function bookId(value) {
  const raw = String(value || '').trim();
  if (/^\d{6,24}$/.test(raw)) return raw;
  try { const url = new URL(raw); if (/(^|\.)fanqienovel\.com$/.test(url.hostname)) return url.pathname.match(/\/(?:page|book)\/(\d{6,24})/)?.[1] || ''; } catch {}
  return '';
}
router.get('/fanqie-cookie-status', (_req, res) => res.json({ configured: fanqieAuth.isReady() }));
router.post('/fanqie-cookie', (req, res) => { fanqieAuth.setCookie(String(req.body.cookie || '').replace(/^Cookie:\s*/i, '')); res.json({ configured: fanqieAuth.isReady() }); });
router.delete('/fanqie-cookie', (_req, res) => { fanqieAuth.setCookie(''); res.json({ configured: false }); });
router.get('/fanqie-preview', async (req, res, next) => {
  try { const id = bookId(req.query.bookId); if (!id) return res.status(400).json({ message: '请输入有效的书籍 ID 或番茄书页链接' }); const info = await scraper.getBookInfo(id); res.json({ title: info.title, chapterCount: info.chapters.length, labels: await scraper.getBookCategory(id).catch(() => []) }); } catch (error) { next(error); }
});
router.get('/fanqie-download', async (req, res, next) => {
  try {
    const id = bookId(req.query.bookId); if (!id) return res.status(400).json({ message: '请输入有效的书籍 ID' });
    const { title, chapters } = await scraper.getBookInfo(id);
    const limit = Math.min(chapters.length, Math.max(1, Math.min(1000, Number(req.query.chapters) || chapters.length)));
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(title + '.txt')}`);
    res.write(`【${title}】\n\n`);
    await scraper.getChapterContents(id, chapters.slice(0, limit), limit, chapter => { if (!res.destroyed) res.write(`第${chapter.chapter_number}章 ${chapter.title}\n${chapter.content}\n\n`); });
    res.end();
  } catch (error) { if (res.headersSent) res.end(); else next(error); }
});
router.post('/fanqie-import', async (req, res, next) => {
  try {
    const id = bookId(req.body.bookId); if (!id) return res.status(400).json({ message: '请输入有效的书籍 ID' });
    const { title, chapters } = await scraper.getBookInfo(id);
    const name = String(req.body.title || title).slice(0, 120), mainCategory = String(req.body.mainCategory || '');
    if (await ReferenceNovel.findOne({ userId: req.userId, title: name, mainCategory })) return res.status(409).json({ message: '同名参考已存在' });
    const limit = Math.min(chapters.length, Math.max(1, Math.min(1000, Number(req.body.chapters) || chapters.length)));
    const contents = await scraper.getChapterContents(id, chapters.slice(0, limit), limit);
    const text = contents.map(chapter => `第${chapter.chapter_number}章 ${chapter.title}\n${chapter.content}`).join('\n\n');
    if (text.length < 200) return res.status(422).json({ message: '未获取到足够正文，请检查网页访问与 Cookie 状态' });
    const doc = await ReferenceNovel.create({ userId: req.userId, title: name, mainCategory, novelType: req.body.novelType || 'normal', gender: 'unisex',
      content: text.slice(0, 5000000), originalLength: text.length, originalFileName: `fanqie_${id}.txt`,
      downloadStats: { totalChapters: limit, downloadedChapters: contents.length, failedChapters: limit - contents.length, avgChapterLength: Math.round(text.length / contents.length) } });
    await require('./reference').startDistillation(doc, req.userModelConfig);
    res.status(202).json({ message: '下载完成，已开始蒸馏', novel: { _id: doc._id, title: doc.title, status: 'processing' } });
  } catch (error) { next(error); }
});
module.exports = router;
