/**
 * 极简观测 SDK —— Agent 侧一行接入。
 *
 *   const tracer = createTracer({ actor: 'seed-agent', model: 'seed-1.6-pro' });
 *   const task = tracer.task('修复登记卡显示不完整');
 *   task.readContext({ file, range, content, reason });
 *   await task.generation({ model, input }, async () => ({ output, usage }));
 *   await task.tool('edit_file', { target: file }, async () => ({ ok: true }));
 *   task.decision({ summary: '...' });
 *   task.test({ command: 'npm test', passed: 38, total: 38 });
 *   task.score('quality', 1);
 *   await task.end('success');
 *
 * 设计原则:
 * - 所有方法绝不抛错阻塞业务(观测可失败,任务不可失败)
 * - observer 未启动时仅警告一次,然后静默
 * - 上下文原文交给 observer 端脱敏;SDK 只补 chars / 行号等元数据
 */

let seq = 0;
const mk = (p) => p + '_' + Date.now().toString(36) + '_' + (seq++).toString(36);

export function createTracer({
  url = (typeof process !== 'undefined' && process.env && process.env.OBSERVER_URL) || 'http://localhost:4318',
  actor = 'seed-agent',
  model = null,
  tags = [],
  demo = false,
  enabled = true
} = {}) {
  let warned = false;

  function send(evt) {
    if (!enabled) return Promise.resolve();
    const payload = { ts: Date.now(), ...evt, meta: { actor, model, tags, demo, ...(evt.meta || {}) } };
    return fetch(url + '/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(() => {}).catch((err) => {
      if (!warned) {
        warned = true;
        console.warn('[sdk] observer 未连接(' + err.message + '),观测事件已暂停上报');
      }
    });
  }

  function task(name, data = {}) {
    const traceId = mk('trace');
    send({ type: 'trace.start', traceId, name, data });

    const api = {
      traceId,
      name,
      send: (evt) => send({ traceId, ...evt }),

      step(stepName, extra = {}) {
        return send({ type: 'task.step', traceId, name: stepName, data: extra });
      },

      readContext({ file, range, lines, content, reason }) {
        const data = { file, range, reason };
        if (lines != null) data.lines = lines;
        if (typeof content === 'string') {
          data.chars = content.length;
          data.content = content;
        }
        return send({ type: 'context.read', traceId, name: 'read ' + (file || '?') + (range ? ':' + range : ''), data });
      },

      async generation({ model: genModel = model, input, temperature, promptChars }, fn) {
        const spanId = mk('gen');
        const t0 = Date.now();
        send({
          type: 'generation.start', traceId, spanId, name: 'generation', data: {
            model: genModel,
            temperature,
            promptChars: promptChars != null ? promptChars : (typeof input === 'string' ? input.length : undefined),
            input
          }
        });
        try {
          const result = (await fn()) || {};
          const usage = result.usage || {};
          await send({
            type: 'generation.end', traceId, spanId, parentId: spanId, name: 'generation', data: {
              model: genModel,
              output: result.output,
              usage: { input: usage.input || usage.prompt_tokens || 0, output: usage.output || usage.completion_tokens || 0, total: usage.total || usage.total_tokens || 0 },
              latencyMs: result.latencyMs != null ? result.latencyMs : Date.now() - t0
            }
          });
          return result;
        } catch (err) {
          send({ type: 'error', traceId, spanId, name: 'generation failed', data: { message: String(err && err.message || err) } });
          throw err;
        }
      },

      async tool(tool, { target, input } = {}, fn) {
        const spanId = mk('tool');
        const t0 = Date.now();
        await send({ type: 'tool.start', traceId, spanId, name: tool + (target ? ' · ' + target : ''), data: { tool, target, input } });
        try {
          const result = (await fn()) || {};
          await send({
            type: 'tool.end', traceId, spanId, parentId: spanId, name: tool + (target ? ' · ' + target : ''), data: {
              tool, ok: result.ok !== false, summary: result.summary, durationMs: Date.now() - t0
            }
          });
          return result;
        } catch (err) {
          await send({
            type: 'tool.end', traceId, spanId, parentId: spanId, name: tool, data: {
              tool, ok: false, summary: String(err && err.message || err), durationMs: Date.now() - t0
            }
          });
          throw err;
        }
      },

      decision({ summary, ...rest }) {
        return send({ type: 'decision', traceId, name: 'decision', data: { summary, ...rest } });
      },

      test({ command, passed, total }) {
        return send({ type: 'test.result', traceId, name: 'e2e', data: { command, passed, total } });
      },

      score(name, value, comment = '') {
        return send({ type: 'score', traceId, name, data: { value, comment } });
      },

      error(message, extra = {}) {
        return send({ type: 'error', traceId, name: 'error', data: { message, ...extra } });
      },

      end(status = 'success', extra = {}) {
        return send({ type: 'trace.end', traceId, name, data: { status, ...extra } });
      }
    };
    return api;
  }

  return { task, send };
}
