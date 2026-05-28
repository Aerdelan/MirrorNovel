const fs = require('fs');
try {
  const buf = fs.readFileSync('fanqie_font.woff2');
  const fontkit = require('fontkit');
  const font = fontkit.create(buf);
  const g2c = new Map();
  for (const code of font.characterSet || []) {
    const g = font.glyphForCodePoint(code);
    if (!g) continue;
    const idx = g.id;
    if (!g2c.has(idx)) g2c.set(idx, []);
    g2c.get(idx).push(code);
  }
  const map = {};
  for (const [, codes] of g2c) {
    if (codes.length < 2) continue;
    const pua = codes.filter(c => c >= 0xE000 && c <= 0xF8FF);
    const norm = codes.filter(c => (c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3000 && c <= 0x303F));
    for (const p of pua) {
      if (norm.length > 0) map[String.fromCodePoint(p)] = String.fromCodePoint(norm[0]);
    }
  }
  console.log('Mappings:', Object.keys(map).length);
  fs.writeFileSync('services/font_mapping.json', JSON.stringify(map, null, 2));
} catch (e) { console.error(e.message); }
