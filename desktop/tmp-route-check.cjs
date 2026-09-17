/** 一次性诊断：读桌面端本机线路配置（脱敏，不打印任何密钥） */
const http = require('http');
const PORT = 9222;

const getJson = (path) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: PORT, path, timeout: 4000 }, (res) => {
    let d = ''; res.on('data', (c) => (d += c));
    res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
  }).on('error', reject);
});
const hostOf = (u) => { try { return new URL(u).host; } catch { return '(非法)'; } };

(async () => {
  let targets;
  try { targets = await getJson('/json/list'); }
  catch (e) { console.log('无法连接 9222（应用未以调试端口启动）:', e.message); process.exit(0); }
  const page = (targets || []).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page) { console.log('无页面目标'); process.exit(0); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const timer = setTimeout(() => { console.log('（超时）'); process.exit(0); }, 15000);
  ws.onopen = () => ws.send(JSON.stringify({
    id: 1, method: 'Runtime.evaluate',
    params: { expression: `localStorage.getItem('mn_model_config_local') || '(空)'`, returnByValue: true },
  }));
  ws.onmessage = (ev) => {
    let msg; try { msg = JSON.parse(String(ev.data)); } catch { return; }
    if (msg.id !== 1) return;
    clearTimeout(timer);
    const raw = msg.result?.result?.value || '(空)';
    console.log('=== 桌面端本机线路配置 ===');
    if (raw === '(空)') { console.log('  未配置（请求不带本机线路，走账号配置）'); process.exit(0); }
    let cfg; try { cfg = JSON.parse(raw); } catch { console.log('  解析失败'); process.exit(0); }
    const routes = cfg.routes || [];
    console.log(`  线路数: ${routes.length}`);
    routes.forEach((r, i) => {
      console.log(`  [${i}] id=${r.id} 名称=${r.name || '(无名)'} 域名=${hostOf(r.baseUrl)} 密钥=${r.apiKey ? '有' : '空'} 模型(writing)=${r.models?.writing || '空'}`);
    });
    const byId = new Map(routes.map((r) => [r.id, r]));
    const def = byId.get(cfg.defaultRouteId) || routes[0];
    console.log(`  默认线路: ${def ? def.name + ' @ ' + hostOf(def.baseUrl) : '(无)'}`);
    console.log('  任务分配(原始):', JSON.stringify(cfg.taskRoutes || {}));
    console.log('  === 每个任务实际生效 ===');
    for (const role of ['outline', 'writing', 'reasoning', 'polish']) {
      const wanted = cfg.taskRoutes?.[role];
      const route = (wanted && byId.get(wanted)) || def;
      console.log(`    ${role.padEnd(10)} → ${route ? route.name + ' @ ' + hostOf(route.baseUrl) : '(无)'}  model=${route?.models?.[role] || route?.models?.writing || ''}`);
    }
    ws.close();
    setTimeout(() => process.exit(0), 80);
  };
  ws.onerror = (e) => { console.log('WebSocket 错误:', e?.message || e); process.exit(0); };
})();
