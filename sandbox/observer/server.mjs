import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { Store } from './store.mjs';
import { createLangfuseExporter } from './langfuse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type'
};

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createObserverServer({ port = 4318, dataFile = join(HERE, 'data', 'events.jsonl'), rawContext = process.env.STORE_RAW_CONTEXT === '1' } = {}) {
  const store = new Store({ dataFile, rawContext });
  const exporter = createLangfuseExporter();
  const clients = new Set();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const json = (code, body) => {
      res.writeHead(code, { ...CORS, 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };

    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS);
        res.end();
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/events') {
        const text = await readBody(req);
        if (!text.trim()) return json(400, { error: 'empty body' });
        const parsed = JSON.parse(text);
        const accepted = store.add(Array.isArray(parsed) ? parsed : [parsed]);
        accepted.forEach(broadcast);
        if (exporter.enabled && accepted.length) exporter.export(accepted);
        res.writeHead(204, CORS);
        res.end();
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/events') {
        const q = url.searchParams;
        const list = store.recent({
          since: Number(q.get('since') || 0),
          limit: Math.min(Number(q.get('limit') || 300), 2000),
          traceId: q.get('traceId') || null,
          types: q.get('types') ? q.get('types').split(',') : null
        });
        return json(200, list);
      }

      if (req.method === 'GET' && url.pathname === '/api/traces') {
        return json(200, store.traces());
      }

      if (req.method === 'GET' && url.pathname.startsWith('/api/traces/')) {
        const id = decodeURIComponent(url.pathname.slice('/api/traces/'.length));
        const list = store.recent({ traceId: id, limit: 2000 });
        const summary = store.traces().find((t) => t.id === id) || null;
        return json(200, { summary, events: list });
      }

      if (req.method === 'GET' && url.pathname === '/api/stats') {
        return json(200, store.stats());
      }

      if (req.method === 'GET' && url.pathname === '/api/health') {
        return json(200, { ok: true, langfuse: exporter.enabled });
      }

      if (req.method === 'POST' && url.pathname === '/api/clear') {
        store.clear();
        return json(200, { ok: true });
      }

      if (req.method === 'GET' && url.pathname === '/api/stream') {
        res.writeHead(200, {
          ...CORS,
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
          'x-accel-buffering': 'no'
        });
        res.write('retry: 1500\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }

      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/dashboard.html')) {
        const html = readFileSync(join(HERE, 'dashboard.html'));
        res.writeHead(200, { ...CORS, 'content-type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      json(404, { error: 'not found' });
    } catch (err) {
      json(500, { error: String((err && err.message) || err) });
    }
  });

  function broadcast(evt) {
    const payload = 'event: append\ndata: ' + JSON.stringify(evt) + '\n\n';
    for (const client of clients) {
      try {
        client.write(payload);
      } catch (err) {
        clients.delete(client);
      }
    }
  }

  const heartbeat = setInterval(() => {
    for (const client of clients) {
      try {
        client.write(': ping\n\n');
      } catch (err) {
        clients.delete(client);
      }
    }
  }, 15000);
  heartbeat.unref();

  return {
    server,
    store,
    exporter,
    listen(p = port) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(p, () => resolve(server.address()));
      });
    },
    close() {
      clearInterval(heartbeat);
      for (const c of clients) {
        try { c.end(); } catch (err) {}
      }
      clients.clear();
      return new Promise((resolve) => server.close(resolve));
    }
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.env.OBSERVER_PORT || 4318);
  const inst = createObserverServer({ port });
  inst.listen(port).then((addr) => {
    console.log('');
    console.log('  SEED · Context Observatory');
    console.log('  ─────────────────────────────');
    console.log('  panel    http://localhost:' + addr.port);
    console.log('  ingest   POST http://localhost:' + addr.port + '/api/events');
    console.log('  stream   GET  http://localhost:' + addr.port + '/api/stream');
    console.log('  langfuse ' + (inst.exporter.enabled ? 'enabled' : 'off (未设置 LANGFUSE_PUBLIC_KEY/SECRET_KEY)'));
    console.log('');
  });
}
