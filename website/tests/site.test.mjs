import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');
const config = JSON.parse(await readFile(join(root, 'site.config.json'), 'utf8'));
const origin = (process.env.SITE_URL || config.origin).replace(/\/$/, '');
async function htmlFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await htmlFiles(path));
    else if (entry.name.endsWith('.html')) files.push(path);
  }
  return files;
}
const files = await htmlFiles(out);
const documents = await Promise.all(files.map(async file => ({ file, html: await readFile(file, 'utf8') })));
const regular = documents.filter(page => !page.file.endsWith('404.html'));
test('all content pages render unique metadata and readable HTML without JavaScript', () => {
  assert.equal(regular.length, 10);
  const titles = new Set(), descriptions = new Set();
  for (const { file, html } of regular) {
    assert.equal((html.match(/<h1[ >]/g) || []).length, 1, file);
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
    const description = html.match(/<meta name="description" content="([^"]+)"/)?.[1];
    assert.ok(title && description, file);
    assert.ok(!titles.has(title) && !descriptions.has(description), file);
    titles.add(title); descriptions.add(description);
    assert.match(html, /<html lang="zh-CN">/);
    assert.match(html, /<main[ >]/);
    assert.ok(!html.includes('{{'), `Unexpanded template in ${file}`);
    assert.ok(!html.includes('noindex'), `Production page excluded from index: ${file}`);
  }
});
test('canonical URLs, sitemap and robots agree on the configured origin', async () => {
  const sitemap = await readFile(join(out, 'sitemap.xml'), 'utf8');
  const locations = Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g), match => match[1]);
  const canonicals = regular.map(page => page.html.match(/<link rel="canonical" href="([^"]+)"/)[1]);
  assert.deepEqual(locations.sort(), canonicals.sort());
  assert.equal(new Set(locations).size, regular.length);
  assert.ok(locations.every(location => location.startsWith(origin + '/')));
  assert.match(await readFile(join(out, 'robots.txt'), 'utf8'), new RegExp(origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/sitemap.xml'));
  assert.ok(!sitemap.includes('404.html'));
  assert.match(documents.find(page => page.file.endsWith('404.html')).html, /noindex,follow/);
});
test('all internal links, fragments, images and script assets resolve', async () => {
  for (const { file, html } of documents) {
    const relativePage = file.slice(out.length).replaceAll('\\', '/').replace(/index\.html$/, '');
    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const value = match[1].replaceAll('&amp;', '&');
      if (/^(mailto:|tel:|data:)/.test(value)) continue;
      const url = new URL(value, origin + relativePage);
      if (url.origin !== origin) continue;
      const target = join(out, decodeURIComponent(url.pathname), url.pathname.endsWith('/') ? 'index.html' : '');
      assert.ok((await stat(target)).isFile(), `${file}: ${value}`);
      if (url.hash && target.endsWith('.html')) {
        const targetHtml = await readFile(target, 'utf8');
        assert.ok(targetHtml.includes(`id="${decodeURIComponent(url.hash.slice(1))}"`), `${file}: missing ${value}`);
      }
    }
    for (const match of html.matchAll(/srcset="([^"]+)"/g)) {
      for (const candidate of match[1].split(',')) await stat(join(out, candidate.trim().split(/\s+/)[0]));
    }
  }
});
test('all contact-author links go to the author GitHub profile', () => {
  let links = 0;
  for (const { html } of documents) {
    for (const match of html.matchAll(/<a\b([^>]+)>([\s\S]*?)<\/a>/g)) {
      if (!/联系作者|作者 GitHub 主页/.test(match[2])) continue;
      assert.equal(match[1].match(/href="([^"]+)"/)?.[1], config.author);
      links++;
    }
    assert.ok(!html.includes('1019601998'));
  }
  assert.ok(links >= regular.length);
});
test('installer is a real static exe link, independent of JavaScript and the release API', () => {
  for (const path of ['index.html', join('download', 'index.html')]) {
    const html = documents.find(page => page.file === join(out, path)).html;
    assert.ok(html.includes(`href="${config.release.url}"`));
    assert.match(config.release.url, /^https:\/\/github\.com\/Aerdelan\/MirrorNovel\/releases\/download\/[^/]+\/[^/]+\.exe$/);
  }
});
test('JSON-LD is valid and software pricing represents the free application', () => {
  for (const { html } of documents) {
    const data = JSON.parse(html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1]);
    assert.equal(data['@context'], 'https://schema.org');
    for (const item of data['@graph']) {
      assert.ok(!('aggregateRating' in item));
      if (item['@type'] === 'SoftwareApplication') {
        assert.equal(item.offers.price, '0');
        assert.equal(item.downloadUrl, config.release.url);
        assert.equal(item.author.url, config.author);
      }
    }
  }
});
test('lightweight assets and image dimensions keep the screenshot homepage within budget', async () => {
  const home = documents.find(page => page.file === join(out, 'index.html')).html;
  const css = home.match(/href="(\/assets\/site\.[^"]+\.css)"/)[1];
  const js = home.match(/src="(\/assets\/site\.[^"]+\.js)"/)[1];
  assert.ok((await stat(join(out, css))).size < 25000);
  assert.ok((await stat(join(out, js))).size < 10000);
  assert.ok((await stat(join(out, 'assets/create-1280.webp'))).size < 180000);
  assert.equal((home.match(/fetchpriority="high"/g) || []).length, 1);
  for (const { html, file } of documents) for (const match of html.matchAll(/<img\b[^>]*>/g)) {
    assert.match(match[0], /\bwidth="\d+"/, file);
    assert.match(match[0], /\bheight="\d+"/, file);
    assert.match(match[0], /\balt="[^"]*"/, file);
  }
});
