/**
 * Langfuse 兼容导出(可选)。
 * 命中 LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY 时才启用;
 * 失败只警告一次,绝不阻塞本地观测。
 */

const pending = new Map(); // spanId -> start event (tool / generation)

function iso(ts) {
  return new Date(ts).toISOString();
}

/** 把一批事件映射成 Langfuse ingestion batch(纯函数,便于测试) */
export function toLangfuseBatch(events, { release = 'stardust' } = {}) {
  const batch = [];
  for (const e of events) {
    const meta = { ...e.meta, tags: e.meta && e.meta.tags, release };
    switch (e.type) {
      case 'trace.start':
      case 'session.start':
        batch.push({
          type: 'trace-create',
          body: {
            id: e.traceId,
            name: e.name || 'trace',
            timestamp: iso(e.ts),
            metadata: { ...e.data, ...meta }
          }
        });
        break;
      case 'generation.start':
        pending.set(e.spanId || e.id, e);
        break;
      case 'generation.end': {
        const start = pending.get((e.parentId || e.spanId)) || e;
        pending.delete(e.parentId || e.spanId);
        batch.push({
          type: 'generation-create',
          body: {
            traceId: e.traceId,
            id: e.spanId || e.id,
            name: e.name || 'generation',
            startTime: iso(start.ts),
            endTime: iso(e.ts),
            model: (start.data && start.data.model) || (e.data && e.data.model) || 'unknown',
            modelParameters: (start.data && start.data.modelParameters) || {},
            input: (start.data && start.data.input) || null,
            output: (e.data && e.data.output) || null,
            usage: (e.data && e.data.usage) || undefined,
            metadata: meta
          }
        });
        break;
      }
      case 'tool.start':
        pending.set(e.spanId || e.id, e);
        break;
      case 'tool.end': {
        const start = pending.get(e.parentId || e.spanId) || e;
        pending.delete(e.parentId || e.spanId);
        batch.push({
          type: 'span-create',
          body: {
            traceId: e.traceId,
            id: e.spanId || e.id,
            name: e.name || (start.data && start.data.tool) || 'tool',
            startTime: iso(start.ts),
            endTime: iso(e.ts),
            input: (start.data && start.data.input) || null,
            output: (e.data && e.data.output) || null,
            metadata: meta
          }
        });
        break;
      }
      case 'context.read':
      case 'decision':
        batch.push({
          type: 'span-create',
          body: {
            traceId: e.traceId,
            id: e.spanId || e.id,
            name: e.name || e.type,
            startTime: iso(e.ts),
            endTime: iso(e.ts),
            input: null,
            output: e.data || null,
            metadata: meta
          }
        });
        break;
      case 'test.result':
        batch.push({
          type: 'span-create',
          body: {
            traceId: e.traceId,
            id: e.spanId || e.id,
            name: e.name || 'test.result',
            startTime: iso(e.ts),
            endTime: iso(e.ts),
            output: e.data || null,
            metadata: meta
          }
        });
        break;
      case 'score':
        batch.push({
          type: 'score-create',
          body: {
            traceId: e.traceId,
            name: e.name || 'score',
            value: (e.data && e.data.value) || 0,
            comment: (e.data && e.data.comment) || ''
          }
        });
        break;
      default:
        break;
    }
  }
  return batch;
}

export function createLangfuseExporter(env = process.env) {
  const publicKey = env.LANGFUSE_PUBLIC_KEY;
  const secretKey = env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) return { enabled: false, export: () => {} };

  const baseUrl = (env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com').replace(/\/$/, '');
  const release = env.RELEASE || 'stardust';
  const auth = Buffer.from(publicKey + ':' + secretKey).toString('base64');
  let warned = false;

  return {
    enabled: true,
    export(events) {
      const batch = toLangfuseBatch(events, { release });
      if (!batch.length) return;
      fetch(baseUrl + '/api/public/ingestion', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Basic ' + auth
        },
        body: JSON.stringify({ batch })
      }).catch((err) => {
        if (!warned) {
          warned = true;
          console.warn('[langfuse] 导出失败(后续静默):', err && err.message);
        }
      });
    }
  };
}
