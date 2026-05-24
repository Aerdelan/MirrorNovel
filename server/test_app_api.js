const PW = require('playwright');
(async () => {
  const br = await PW.chromium.launch({headless:true,args:['--no-sandbox']});
  const ctx = await br.newContext({
    userAgent: 'com.dragon.read/67532 (Linux; U; Android 9; zh_CN; ASUS_I005DA)',
    extraHTTPHeaders: {
      'Cookie': 'store-region=cn-yn; install_id=1408906374261642; odin_tt=f693e06644c6018656c87642668ed589769ad96574a56b8d1a10df97f6cf337faa77eca258dd8d9a4bbe81e462434e2c43202d8eaad98c5493cfd4fb4797533fd672f40ec14c293e394529efe3b7ac52; passport_csrf_token=40ef3528b447c66518506eb19a38f25d',
      'x-gorgon': '8404c05b00006604d8aafcf7928eff884d13b2f8e8102f89ef67',
      'x-argus': 's4hKaA==',
      'x-ladon': 'aEqIsw==',
      'x-khronos': '1749715123',
      'x-soter': 'AAEAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'x-helios': 'mR6bAP/kc8SiVagw03Lx3fvOpHfk3gdRCR1oIri407ptY7m2',
      'x-medusa': 't4hKaKHnyh1VDfheC2POopFDCYAqHAABNJlNk+UxAU8tGPd2PiMU/bG5G1s1XYsRU2g1cMYKbsCG9XI1lg8dQkwMWQdFSWd/xgNCLSUDuiqCL35qkONQ83qVCgttMDXcl0NER6iVQR48Wp3Pm6c12L8gfnz/o9qc3Zkn5NrsJkHpyVtLBkHcbPHqXvzizJwtX5eg3Z/Rz8k5/tLAmlmtQ7QbPrG/N2JpXuc8kwDSs3KIxOgVjzohqlTKmtW7+2X9xEVT3ty81vakofUT6mfy1KrNGFJwtjDT681JxKi/SFniGM5WwheIf/MDo4jV9SHx0HGTW/EAf4jVG1fZEz4ys71QVBZSN5PE8AfiNb3wHoL8rbZRk02tnUdfJXpI+oCy2I+/Augafq2GUbH9JyrM0CQrTRJFGTs7Q3gGIBlb3zMdOOYZgl4U6D36ohRJha+AXJK8HCSVST2jgQdCTwKN4WN8NO7gHSg2g6PK504eprVWDqi0WbNHgw4h9jYz8WQr8W1KbFcE5yw6UsscK2+ndYFcuzRMALgqhcjOvDpLS+prGcIHTUdPf+eqzgIDaCEAnMJkv65oOrUIM8moUVSh3X1dk3nPmep3NjRtTVoJtd/A8w+HisGyhhzE/S0d8sCBcal2SqfKfzP1UA0uJSwIj5EfE5+aTIX0wQ7DMh8IlsiVggwSRNU+Bhwe9qfDo5xx+44iNqe7G0uPLEgElOboBWQG/+6p+Z6BSs1jl1cXxlX0x0alYL7DrEkgSpCqnc1QXOez48bBoGfgUqHB+d4WEHFJ8upapH2ZQTYtUXaDAcGqUI1vGXT76AKy2bK9FqDs9Jmtj8QbvQkBQc2f+MesqKGh4C7JHpk8fwOPDuNLDwvElm7UrKoRHzdfzqDovueG4zXXSvHar+ru1rXCov4bkd5TVX3+Z22ePziiS2bPstXgHLWzWlinAVO13y2a/D3P8DAuKcM6w3BAx5Nzcf5AMwERUe0WwNidKXpPuk17ohzudbO8bIDjvC3cVq7ZG3SW+FvACGg4V4krbv/4F27/+Bf9aw==',
    }
  });
  const p = await ctx.newPage();
  const result = await p.evaluate(async () => {
    const url = 'https://api5-normal-sinfonlineb.fqnovel.com/reading/bookapi/detail/v?without_video=false&book_id=7523571668594215960&item_id=7554588700689039896&iid=1408906374261642&device_id=1408906374257546&ac=wifi&aid=1967&version_code=67532&version_name=6.7.5.32&device_platform=android&os_api=28&os_version=9&resolution=800*1280&dpi=240&_rticket=' + Date.now();
    try {
      const r = await fetch(url, {headers: {'Accept': 'application/json'}});
      const j = await r.json();
      if (j.data) return {code: j.code || 0, hasContent: !!j.data.content, contentLen: j.data.content?.length || 0, keys: Object.keys(j.data).slice(0,10)};
      return {error: 'no data', raw: JSON.stringify(j).slice(0,200)};
    } catch(e) { return {error: e.message}; }
  });
  console.log(JSON.stringify(result, null, 2));
  await br.close();
})().then(() => process.exit(0)).catch(e => console.log('FAIL:', e.message));
