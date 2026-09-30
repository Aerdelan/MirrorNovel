import fs from 'node:fs/promises';
import path from 'node:path';

const endpoint = 'http://127.0.0.1:9222/json/list';

async function getTarget() {
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(`Cannot read Electron targets: ${response.status}`);
  const targets = await response.json();
  const target = targets.find((item) => item.type === 'page' && /MirrorNovel/i.test(item.title || ''))
    || targets.find((item) => item.type === 'page');
  if (!target?.webSocketDebuggerUrl) throw new Error('No Electron page target found');
  return target;
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result || {});
  });
  return {
    send(method, params = {}) {
      const id = ++nextId;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close() { socket.close(); },
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Evaluation failed');
  return result.result?.value;
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const [command = 'inspect', ...args] = process.argv.slice(2);
  const target = await getTarget();
  const cdp = await connect(target.webSocketDebuggerUrl);
  try {
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: 1920,
      screenHeight: 1080,
    });

    if (command === 'inspect') {
      const state = await evaluate(cdp, `(() => ({
        url: location.href,
        title: document.title,
        text: document.body.innerText.slice(0, 24000),
        storageKeys: Object.keys(localStorage),
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }
      }))()`);
      process.stdout.write(JSON.stringify(state, null, 2));
      return;
    }

    if (command === 'goto') {
      const route = args[0];
      if (!route) throw new Error('goto requires a hash route');
      await evaluate(cdp, `location.hash = ${JSON.stringify(route.startsWith('#') ? route : `#${route}`)}`);
      await wait(Number(args[1]) || 1800);
      const state = await evaluate(cdp, `({ url: location.href, text: document.body.innerText.slice(0, 20000) })`);
      process.stdout.write(JSON.stringify(state, null, 2));
      return;
    }

    if (command === 'eval') {
      const expression = args.join(' ');
      if (!expression) throw new Error('eval requires an expression');
      const value = await evaluate(cdp, expression);
      process.stdout.write(JSON.stringify(value, null, 2));
      return;
    }

    if (command === 'click-text') {
      const label = args[0];
      if (!label) throw new Error('click-text requires a label');
      const exact = args[1] !== 'contains';
      const expression = `(() => {
        const wanted = ${JSON.stringify(label)};
        const nodes = Array.from(document.querySelectorAll('button, [role="button"], label'));
        const node = nodes.find((item) => {
          const text = (item.innerText || item.textContent || '').trim();
          return ${exact ? 'text === wanted' : 'text.includes(wanted)'};
        });
        if (!node) return { ok: false, label: wanted };
        node.click();
        return { ok: true, text: (node.innerText || node.textContent || '').trim() };
      })()`;
      const value = await evaluate(cdp, expression);
      await wait(Number(args[2]) || 300);
      process.stdout.write(JSON.stringify(value, null, 2));
      return;
    }

    if (command === 'scroll') {
      const amount = Number(args[0]) || 0;
      const value = await evaluate(cdp, `(() => { window.scrollTo({ top: ${amount}, behavior: 'instant' }); return { top: window.scrollY }; })()`);
      await wait(Number(args[1]) || 300);
      process.stdout.write(JSON.stringify(value, null, 2));
      return;
    }

    if (command === 'capture') {
      const output = path.resolve(args[0] || 'capture.png');
      const delayMs = Number(args[1]) || 400;
      await wait(delayMs);
      const result = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
        fromSurface: true,
      });
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, Buffer.from(result.data, 'base64'));
      process.stdout.write(output);
      return;
    }

    throw new Error(`Unknown command: ${command}`);
  } finally {
    cdp.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
