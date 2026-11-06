# Seed · Context Observatory

本地优先的「模型任务观测」进程：实时接收事件、聚合任务链、脱敏落盘，并可选导出到 Langfuse。

> 目标：让评委随时看到 **模型接到了什么任务、读了哪些上下文、调了哪些工具、跑没跑测试、花了多少 token**——而不是只看最终代码。

## 快速开始

```bash
cd observer
npm start          # 面板 http://localhost:4318
npm run demo       # 另开终端:播放一段真实感的任务事件流(约 30s)
```

打开游戏并让它上报（游戏侧零依赖，静默失败）：

```text
stardust.html?observe=1
或 stardust.html?observe=http://localhost:4318
```

```
浏览器游戏 ──POST /api/events──▶ observer ──SSE──▶ 面板
Agent 脚本 ──POST /api/events──▶    │
                                    ├─ JSONL 落盘(默认脱敏)
                                    └─ Langfuse 导出(可选, env 开启)
```

## 事件模型（Langfuse 兼容）

```json
{
  "type": "context.read",
  "traceId": "trace_abc",
  "spanId": "sp_1",
  "ts": 1793866812000,
  "name": "read stardust.html:515-650",
  "meta": { "actor": "seed-agent", "model": "seed-1.6-pro", "tags": ["stardust"] },
  "data": {
    "file": "sandbox/stardust.html",
    "range": "L515-650",
    "chars": 4830,
    "content": { "chars": 4830, "sha256": "9f2c…", "preview": "…" }
  }
}
```

| 事件 | 含义 | Langfuse 映射 |
| --- | --- | --- |
| `trace.start` / `session.start` | 一次任务开始 | trace-create |
| `generation.start` / `generation.end` | 一次模型调用（含 usage/latency） | generation-create |
| `tool.start` / `tool.end` | 工具调用（编辑/命令/浏览器） | span-create（起止合成） |
| `context.read` | 读取的上下文片段（文件+行号+字符数） | span-create |
| `decision` | 关键判断（如根因判定） | span-create |
| `test.result` | 测试结果 | span-create |
| `score` | 质量评分 | score-create |
| `task.step` / `task.complete` | 游戏会话步骤/通关 | 本地聚合 |

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/events` | 单条或数组，返回 204 |
| GET | `/api/events?limit=&traceId=&types=` | 查询事件 |
| GET | `/api/traces` | 任务聚合（工具数/上下文/token/测试/状态） |
| GET | `/api/traces/:id` | 单任务详情 |
| GET | `/api/stats` | 总量统计 |
| GET | `/api/stream` | SSE 实时推送（事件名 `append`） |
| POST | `/api/clear` | 清空 |

CORS 全开（游戏来自 `file://` 也能上报）；事件入库前统一脱敏。

## 隐私默认

- `content / text / code / prompt / messages / input / output` 字段超过 40 字符 → 只存 **字符数 + sha256(前16) + 120 字预览**
- 其他字段超过 400 字符同样截断为摘要
- `STORE_RAW_CONTEXT=1` 才保留原文（仅本地调试用）
- 不记录任何模型隐藏推理，只记录应用层可见的输入/输出/工具轨迹

## Langfuse 对接（可选）

```bash
LANGFUSE_PUBLIC_KEY=pk-... \
LANGFUSE_SECRET_KEY=sk-... \
LANGFUSE_BASE_URL=http://localhost:3000 \
node server.mjs
```

- 未配置时静默关闭，本地面板照常工作
- 导出在脱敏之后进行，失败只警告一次，不阻塞
- 映射逻辑是纯函数（`langfuse.mjs`），有单测覆盖

## 一行接入（sdk.mjs）

给 Agent 侧的最小 SDK，所有方法「观测失败不影响业务」：

```js
import { createTracer } from './observer/sdk.mjs';

const tracer = createTracer({ actor: 'seed-agent', model: 'seed-1.6-pro' });
const task = tracer.task('修复登记卡显示不完整', { task: '...' });

task.readContext({ file, range: 'L515-650', content, reason });
await task.generation({ model, input, temperature: 0.2 }, async () => ({ output, usage }));
await task.tool('edit_file', { target: file }, async () => ({ ok: true, summary: '+86 −34' }));
task.decision({ summary: '父级 filter 拍平导致裁剪' });
task.test({ command: 'npm test', passed: 38, total: 38 });
task.score('implementation-quality', 1);
await task.end('success');
```

- `generation` / `tool` 接收回调，自动记录起止、耗时、usage；回调抛错时先上报失败态再透传异常
- observer 未启动时只告警一次，然后静默——观测永远不能让任务失败
- `demo.mjs` 就是基于它实现的，可作接入模板

## 测试

```bash
npm test   # 20 断言:入库/脱敏/聚合/SSE/面板/Langfuse 映射/SDK 接入与异常链路
```

## 真实调用 Seed（可选）

```bash
ARK_API_KEY=... ARK_MODEL=doubao-seed-1-6 node demo.mjs --live
```

`--live` 会用真实 API 替换演示 generation 的 usage/延迟；未配置则回退脚本数据并标注 `DEMO`。

## 目录

```
server.mjs      HTTP + SSE + 静态面板
store.mjs       环形缓冲 / JSONL / 脱敏 / 聚合
langfuse.mjs    Langfuse 映射 + 导出器
sdk.mjs         Agent 侧接入 SDK(一行接入)
dashboard.html  实时面板（时间线 + 任务卡）
demo.mjs        演示事件流（--speed / --live，基于 sdk）
capture.mjs     面板截图工具
test.mjs        20 断言
```
