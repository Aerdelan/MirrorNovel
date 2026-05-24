const PW = require('playwright');
const FD = require('./services/fontDecoder');
const path = require('path');
let fontMapping = null;
try { fontMapping = require('./services/font_mapping.json'); } catch(e) { console.log('no mapping'); }
async function test() {
  const br = await PW.chromium.launch({headless:true,args:['--no-sandbox']});
  const ctx = await br.newContext({userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'});
  const p = await ctx.newPage();
  await p.goto('https://fanqienovel.com/page/7523571668594215960',{waitUntil:'domcontentloaded',timeout:30000});
  await p.waitForTimeout(4000);
  const chapters = await p.evaluate(() => {
    for(const s of document.querySelectorAll('script')) {
      const m = s.textContent.match(/chapterListWithVolume\s*=\s*(\[[\s\S]*?\])\s*;/);
      if(m) { try { const raw=m[1].replace(/\\/g,''); return JSON.parse(raw).slice(0,3); } catch(e) {} }
    }
    return null;
  });
  if(!chapters || chapters.length === 0) { console.log('No chapters'); await br.close(); return; }
  console.log('First:', chapters[0].item_id, chapters[0].title);
  let captured = null;
  p.on('response', async (resp) => {
    if(!resp.url().includes('/api/reader/full')) return;
    try { const j=await resp.json(); if(j?.data?.content) captured=j.data.content; } catch(e) {}
  });
  await p.goto('https://fanqienovel.com/reader/'+chapters[0].item_id,{waitUntil:'domcontentloaded',timeout:30000});
  await p.waitForTimeout(3000);
  if(!captured) {
    captured = await p.evaluate(() => {
      const e=document.querySelector('.chapter-content,.read-content,.content,article');
      if(e) return e.textContent.slice(0,500);
      return Array.from(document.querySelectorAll('p')).map(p=>p.textContent).join('\n').slice(0,500);
    });
  }
  console.log('\n=== RAW ===\n'+captured.slice(0,300));
  const hasPUA = /[\uE000-\uF8FF]/.test(captured);
  console.log('\nHas PUA:', hasPUA, 'Count:', (captured.match(/[\uE000-\uF8FF]/g)||[]).length);
  if(fontMapping) {
    const d = FD.decodeText(captured.slice(0,500), fontMapping);
    console.log('\n=== DECODED ===\n'+d.slice(0,300));
    console.log('\nStill PUA:', /[\uE000-\uF8FF]/.test(d));
  }
  await br.close();
}
test().then(()=>{console.log('DONE');process.exit(0)}).catch(e=>{console.log('FAIL:',e.message);process.exit(1)});
