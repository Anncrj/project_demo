# 星尘琥珀 · 闭馆谜题

闭馆后的自然博物馆「星尘厅」里,讲解员林晚的说辞滴水不漏。旋转穹顶星图、调亮聚光灯、拼完拼豆画、查钥匙登记——每出示一件证物,她的防线就崩塌一分。最终由你在「上报」与「替她争取特展」之间做出抉择。

## 目录结构

```
.
├─ server/            # Seed/ARK 后端(Express + OpenAI SDK,读取 ARK_API_KEY 环境变量)
│  └─ index.js
└─ sandbox/           # 游戏本体 + 后台 Agent + 测试
   ├─ stardust.html   # 单文件游戏(纯前端,file:// 可直接打开)
   ├─ server/         # 后台 Agent 状态机服务(零依赖 Node)
   │  ├─ agent-core.mjs
   │  └─ agent-server.mjs
   ├─ observer/       # 任务观测面板(可选)
   └─ tests/          # E2E 与 Agent 测试
```

## 运行

### 1) 直接玩(离线)

双击打开 `sandbox/stardust.html` 即可。离线时支线由本地状态机驱动,任务卡片右上角显示「本地」。

### 2) 带后台 Agent(推荐)

```bash
cd sandbox
npm run agent            # 默认 http://localhost:8907
```

浏览器打开 <http://localhost:8907/> —— 页面与 Agent 同源,会自动连上(右上角显示「Agent」),点击与对话由后台状态机判定。

自定义端口:`PORT=9000 npm run agent`

### 3) Seed/ARK 后端(可选,需要密钥)

```bash
cd server
npm install
# 先设置密钥(不要写进代码)
# PowerShell:  $env:ARK_API_KEY="你的key"
# bash:        export ARK_API_KEY="你的key"
npm start                # 默认 http://localhost:3000
```

## 测试

```bash
cd sandbox
npm test                 # 前端回归 E2E
npm run test:agent       # Agent 状态机 + HTTP 接口
npm run test:agent-e2e   # 浏览器连后台 Agent 的支线闭环
npm run agent:selftest   # 打印状态机判定过程
```

## 安全说明

- **密钥只放环境变量**,不要写进源码;`.env` 已被 `.gitignore` 忽略,仅提供 `.env.example` 模板。
- 运行时数据(`server/data/`、`sandbox/observer/data/`)和 `node_modules/` 不提交。
- 提交前用 `git status` 复核,确认没有 `.env`、密钥、日志、截图产物混入。

## 许可证

未指定。若要公开,建议补充 `LICENSE`(如 MIT)。
