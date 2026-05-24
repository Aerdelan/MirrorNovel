// 测试 SVIP Cookie 是否能获取锁定章节完整内容
const https = require('https');

const cookies = 'sessionid=4c1f5ba990ad5a7ba2c0712af368762f';
const itemId = '7554588700689039896'; // 锁定章节

const url = 'https://fanqienovel.com/api/reader/full?itemId=' + itemId;

https.get(url, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Cookie': cookies,
    'Referer': 'https://fanqienovel.com/',
    'Accept': 'application/json',
  }
}, (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      const cd = json?.data?.chapterData || {};
      const text = (cd.content || '').replace(/<[^>]+>/g, '');
      console.log('Content length:', text.length);
      console.log('Word count:', cd.chapterWordNumber);
      console.log('Locked:', cd.isChapterLock);
      console.log('Need pay:', cd.needPay);
      console.log('Platform:', cd.platform);
      if (text.length > 200) {
        console.log('=== FULL CONTENT AVAILABLE ===');
        console.log('First 200:', text.slice(0, 200));
        console.log('Last 200:', text.slice(-200));
      } else {
        console.log('=== STILL PREVIEW ONLY ===');
        console.log('Content:', text);
      }
    } catch (e) {
      console.log('Parse error:', e.message);
      console.log('Raw response:', data.slice(0, 500));
    }
  });
}).on('error', e => console.log('Error:', e.message));
