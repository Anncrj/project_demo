import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
const MODEL = 'doubao-seed-evolving';

const PROFILE_DIR = path.join(__dirname, 'data');
const PROFILE_FILE = path.join(PROFILE_DIR, 'profiles.json');

const client = new OpenAI({
  baseURL: ARK_BASE_URL,
  apiKey: process.env.ARK_API_KEY,
});

const app = express();
app.use(express.json({ limit: '50mb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.static(path.join(__dirname, '..', 'sandbox')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, model: MODEL });
});

async function readProfiles() {
  try {
    return JSON.parse(await fs.readFile(PROFILE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function writeProfiles(profiles) {
  await fs.mkdir(PROFILE_DIR, { recursive: true });
  await fs.writeFile(PROFILE_FILE, JSON.stringify(profiles, null, 2), 'utf8');
}

const PLAYER_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

app.get('/api/profile/:playerId', async (req, res) => {
  if (!PLAYER_ID_RE.test(req.params.playerId)) {
    return res.status(400).json({ error: 'invalid playerId' });
  }
  const profiles = await readProfiles();
  res.json(profiles[req.params.playerId] ?? null);
});

app.put('/api/profile/:playerId', async (req, res) => {
  if (!PLAYER_ID_RE.test(req.params.playerId)) {
    return res.status(400).json({ error: 'invalid playerId' });
  }
  const profiles = await readProfiles();
  const playerId = req.params.playerId;
  const existing = profiles[playerId];
  const now = new Date().toISOString();
  profiles[playerId] = {
    ...existing,
    ...req.body,
    playerId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await writeProfiles(profiles);
  res.json(profiles[playerId]);
});

app.post('/api/npc', async (req, res) => {
  const { imageBase64, text, stateJson } = req.body ?? {};

  const content = [];

  if (imageBase64) {
    content.push({
      type: 'image_url',
      image_url: {
        url: imageBase64.startsWith('data:')
          ? imageBase64
          : `data:image/jpeg;base64,${imageBase64}`,
      },
    });
  }

  if (text) {
    content.push({ type: 'text', text });
  }

  if (stateJson !== undefined && stateJson !== null && stateJson !== '') {
    content.push({
      type: 'text',
      text: typeof stateJson === 'string' ? stateJson : JSON.stringify(stateJson),
    });
  }

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content }],
    });
    res.json(completion);
  } catch (err) {
    res.status(err?.status ?? 500).json({ error: err?.message ?? String(err) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`doubao seed demo server listening on http://localhost:${port} (model: ${MODEL})`);
});
