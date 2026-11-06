import { appendFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';

/**
 * 事件存储:环形缓冲 + JSONL 落盘 + 聚合查询。
 * 默认对上下文原文做「字符数 + 哈希 + 预览」脱敏,STORE_RAW_CONTEXT=1 才保留原文。
 */

const CONTENT_KEYS = new Set(['content', 'text', 'code', 'prompt', 'messages', 'input', 'output']);

function digest(str) {
  return {
    chars: str.length,
    sha256: createHash('sha256').update(str).digest('hex').slice(0, 16),
    preview: str.slice(0, 120)
  };
}

function sanitizeValue(value, raw) {
  if (Array.isArray(value)) return value.map((v) => sanitizeValue(v, raw));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === 'string' && v.length > 40 && !raw) {
        out[k] = CONTENT_KEYS.has(k) || v.length > 400 ? digest(v) : v;
      } else if (typeof v === 'string' && v.length > 40 && raw && CONTENT_KEYS.has(k)) {
        out[k] = v;
        out[k + '_digest'] = digest(v);
      } else {
        out[k] = sanitizeValue(v, raw);
      }
    }
    return out;
  }
  return value;
}

let seq = 0;

function normalize(raw) {
  const evt = {
    id: raw.id || 'evt_' + Date.now().toString(36) + '_' + (seq++).toString(36),
    ts: typeof raw.ts === 'number' ? raw.ts : Date.now(),
    type: String(raw.type || 'event'),
    traceId: raw.traceId || 'no-trace',
    spanId: raw.spanId || null,
    parentId: raw.parentId || null,
    name: raw.name || '',
    level: raw.level || 'default',
    meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : {},
    data: raw.data && typeof raw.data === 'object' ? raw.data : {}
  };
  return evt;
}

export class Store {
  constructor({ dataFile = null, limit = 5000, rawContext = false } = {}) {
    this.events = [];
    this.limit = limit;
    this.rawContext = rawContext;
    this.dataFile = dataFile;
    if (dataFile) {
      try {
        mkdirSync(dirname(dataFile), { recursive: true });
        appendFileSync(dataFile, '', 'utf8');
      } catch (err) {
        this.dataFile = null;
      }
    }
  }

  add(list) {
    const accepted = [];
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue;
      const evt = normalize(raw);
      evt.data = sanitizeValue(evt.data, this.rawContext);
      this.events.push(evt);
      accepted.push(evt);
    }
    if (this.events.length > this.limit) {
      this.events.splice(0, this.events.length - this.limit);
    }
    if (this.dataFile && accepted.length) {
      try {
        appendFileSync(this.dataFile, accepted.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
      } catch (err) {
        /* 落盘失败不影响内存观测 */
      }
    }
    return accepted;
  }

  recent({ since = 0, limit = 300, traceId = null, types = null } = {}) {
    let list = this.events.filter((e) => e.ts >= since);
    if (traceId) list = list.filter((e) => e.traceId === traceId);
    if (types && types.length) list = list.filter((e) => types.some((t) => e.type.startsWith(t)));
    return list.slice(-limit);
  }

  traces() {
    const map = new Map();
    for (const e of this.events) {
      let t = map.get(e.traceId);
      if (!t) {
        t = {
          id: e.traceId,
          name: '',
          status: 'running',
          startedAt: e.ts,
          endedAt: null,
          events: 0,
          tools: 0,
          generations: 0,
          tokens: { input: 0, output: 0 },
          context: { files: {}, chars: 0 },
          tests: null,
          scores: [],
          lastEvent: e.type,
          actors: new Set(),
          demo: false
        };
        map.set(e.traceId, t);
      }
      t.events++;
      t.lastEvent = e.type;
      if (e.meta && e.meta.actor) t.actors.add(e.meta.actor);
      if (e.meta && e.meta.demo) t.demo = true;
      if (!t.name) {
        if (e.type === 'trace.start' || e.type === 'task.start' || e.type === 'session.start') {
          t.name = e.name || (e.data && (e.data.task || e.data.title)) || '';
        }
      }
      if (e.type === 'context.read') {
        const file = (e.data && e.data.file) || 'unknown';
        const chars = (e.data && (e.data.chars || e.data.lines)) || 0;
        t.context.files[file] = (t.context.files[file] || 0) + chars;
        t.context.chars += typeof chars === 'number' ? chars : 0;
      }
      if (e.type === 'tool.start') t.tools++;
      if (e.type === 'generation.end' && e.data && e.data.usage) {
        t.generations++;
        t.tokens.input += e.data.usage.input || 0;
        t.tokens.output += e.data.usage.output || 0;
      }
      if (e.type === 'test.result' || e.type === 'task.test') {
        t.tests = {
          passed: (e.data && e.data.passed) || 0,
          total: (e.data && e.data.total) || 0,
          command: (e.data && e.data.command) || ''
        };
      }
      if (e.type === 'score') {
        t.scores.push({ name: e.name || 'score', value: (e.data && e.data.value) || 0 });
      }
      if (e.type === 'trace.end') {
        t.status = (e.data && e.data.status) || 'success';
        t.endedAt = e.ts;
      }
      if (e.type === 'task.complete') {
        t.status = 'success';
        t.endedAt = t.endedAt || e.ts;
      }
      if (e.type === 'error') t.status = 'error';
    }
    return Array.from(map.values())
      .map((t) => {
        const end = t.endedAt || (t.status === 'running' ? Date.now() : t.startedAt);
        return {
          ...t,
          actors: Array.from(t.actors),
          durationMs: Math.max(0, end - t.startedAt),
          context: {
            files: Object.entries(t.context.files).map(([file, chars]) => ({ file, chars })),
            chars: t.context.chars
          }
        };
      })
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  stats() {
    const traces = this.traces();
    return {
      events: this.events.length,
      traces: traces.length,
      tools: traces.reduce((n, t) => n + t.tools, 0),
      generations: traces.reduce((n, t) => n + t.generations, 0),
      tokens: traces.reduce((n, t) => n + t.tokens.input + t.tokens.output, 0),
      tests: traces.filter((t) => t.tests).map((t) => t.tests),
      statuses: traces.reduce((acc, t) => {
        acc[t.status] = (acc[t.status] || 0) + 1;
        return acc;
      }, {})
    };
  }

  clear() {
    this.events = [];
  }
}
