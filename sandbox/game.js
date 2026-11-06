const API_URL = '/api/npc';
const PROFILE_URL = '/api/profile';
const SHOT_QUALITY = 0.85;
const HISTORY_LIMIT = 40;
const ALIGNED_LIGHT = 1;
const ALIGNED_PROJ = 2;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const chatLog = document.getElementById('chat-log');
const composer = document.getElementById('composer');
const input = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const statusEl = document.getElementById('status');
const modelChip = document.getElementById('model-chip');
const profileChip = document.getElementById('profile-chip');
const clueBar = document.getElementById('clue-bar');
const topicBar = document.getElementById('topic-bar');
const objectiveEl = document.getElementById('objective');
const introEl = document.getElementById('intro');
const introNameEl = document.getElementById('intro-name');
const introText = document.getElementById('intro-text');
const introNext = document.getElementById('intro-next');
const introSkip = document.getElementById('intro-skip');
const certModal = document.getElementById('cert-modal');
const certRestart = document.getElementById('cert-restart');
const minigameModal = document.getElementById('minigame-modal');
const minigameFrame = document.getElementById('minigame-frame');
const minigameStatus = document.getElementById('minigame-status');
const minigameClose = document.getElementById('minigame-close');
const minigameRestart = document.getElementById('minigame-restart');

const DIRECTOR_RULES = `【沙箱导演指令】当前场景:自然博物馆「星尘厅」闭馆调试夜,NPC 是讲解员林晚。你在扮演林晚的同时兼任本推理场景的导演:
1. 只以林晚的身份和口吻说话(温柔、略紧张、怕被追责,但内心善良)。根据 state 里的 clues、pressedTopics、trust 判断哪些她能说、哪些还要回避,不要提前剧透真相。
2. 根据 state 里的 history、stats、线索收集进度自行判断玩家是否陷入瓶颈(多轮无新进展、未利用已有线索、反复兜圈)。是否给提示、是否触发提示小游戏,由你自行决定。
3. 若决定用小游戏提示玩家:在正常回复之后追加一个 <minigame>...</minigame> 块,内容为自包含 HTML 小游戏(单文件、内联 CSS/JS、禁止任何外部资源与网络请求、中文界面、主题必须围绕当前线索、难度小、60 秒内可通关、适配窄屏)。
4. 小游戏通关时必须调用 parent.postMessage({source:'minigame',type:'complete',success:true},'*');玩家失败时可传 success:false。
5. 不需要小游戏时,不要输出 <minigame> 块。`;

const INTRO_LINES = [
  '欢迎来到自然博物馆·星尘厅。今晚闭馆调试,馆里只剩我们两个人。',
  '穹顶的星空是按标准星表投的,全息星图也是……按流程调的。',
  '不过,我总觉得哪里不太对。你愿意帮我看看吗?不用急,慢慢来。',
  '头顶的聚光灯、那颗多出来的星、休息区桌上的画,还有钥匙柜和讲解台——留意它们,有发现就回来告诉我。',
];

const EPILOGUE_LINES = [
  '那一夜,星尘厅的灯没有全灭——有人为一个小姑娘,留了一整片星空。',
  '老馆长写完了最后一页讲解稿,周叔把钥匙借了出去,林晚调好了光,把画里的星位一笔一笔搬进了投影。',
  '他们约好,等她出院那天,请她亲手把画挂进主展柜。证书上的名字,是大家偷偷写好的。',
  '雨停了。穹顶的星星一颗一颗亮起来,像在回应谁。',
];

const STORY = {
  glassReflection: {
    title: '一段没录完的讲解',
    text: '反光里浮出星星的轮廓,像有人把光调到了刚好能看见的角度。林晚小声说:「我本来想录一段讲解,发给住院的孩子……」话到一半,她停住了。',
  },
  extraStar: {
    title: '画纸上的那颗星',
    text: '多出的暖色星和画上的一模一样。林晚盯着它看了很久:「她说,等病好了,要亲自来认领这颗星。」',
  },
  drawingMatch: {
    title: '星位重合的一瞬',
    text: '画与投影在同一个星位重叠——这不是调试误差,是有人一笔一笔照着画的。林晚别过头,耳根红了。',
  },
  keyLog: {
    title: '19:42 的借用登记',
    text: '借用登记卡上,周叔的字迹潦草:「馆长特别交代」。落款时间,正是闭馆前最后一盏走廊灯熄灭的时候。',
  },
  curatorScript: {
    title: '老馆长的最后一页',
    text: '讲解稿最后一行是老馆长的字:「那颗暖色的星,留给一个会画星星的小朋友。」墨迹很新,像是今晚才写完的。',
  },
};

function uuid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `p-${Math.random().toString(36).slice(2)}${Date.now()}`;
}

function getPlayerId() {
  let id = localStorage.getItem('seed-demo-player-id');
  if (!id) {
    id = uuid();
    localStorage.setItem('seed-demo-player-id', id);
  }
  return id;
}

const playerId = getPlayerId();

function freshState() {
  return {
    stage: 0,
    trust: 0,
    lightAngle: 1,
    projAngle: 1,
    drawingPlaced: false,
    cabinetOpen: false,
    scriptRead: false,
    clues: {
      extraStar: false,
      glassReflection: false,
      drawingMatch: false,
      keyLog: false,
      curatorScript: false,
    },
    pressedTopics: [],
    truthRevealed: false,
  };
}

let S = freshState();

const CLUE_META = {
  extraStar: '投影多出的星',
  glassReflection: '玻璃反光星点',
  drawingMatch: '画与投影对齐',
  keyLog: '钥匙借用记录',
  curatorScript: '老馆长讲解稿',
};

const topics = [
  {
    id: 't_projection',
    label: '投影星图上多了一颗星……是你调的吗?',
    requires: () => true,
    reply: () => {
      if (S.clues.extraStar && S.clues.drawingMatch) {
        return '……那颗星,是我照着小满的画调进去的。她住院前画过一张星图,就压在休息区的桌上。';
      }
      if (S.clues.extraStar) {
        return '那颗星?可能是投影调试的残留吧……你别多想。';
      }
      return '星图是标准科普版,按流程调试的,没动过。';
    },
    onAsk: () => {
      S.stage = Math.max(S.stage, 1);
    },
  },
  {
    id: 't_light',
    label: '展柜的灯……好像不是自动的?',
    requires: () => true,
    reply: () => {
      if (S.clues.glassReflection) {
        return S.trust >= 2
          ? '我调过灯。想让琥珀的光刚好照到玻璃上,给孩子录一段讲解……这件事,我本来想悄悄做好的。'
          : '我调过灯。想让琥珀的光刚好照到玻璃上,给孩子录一段讲解……';
      }
      return '灯是自动感应的,我没碰。';
    },
  },
  {
    id: 't_key',
    label: '钥匙登记上写着周叔——怎么回事?',
    requires: () => S.clues.keyLog,
    reply: () => '钥匙是周叔借我的。他说老馆长交代过,今晚要给一个孩子开个"小专场"。',
    onAsk: () => {
      S.trust = Math.min(3, S.trust + 1);
    },
  },
  {
    id: 't_truth',
    label: '我知道了。让我把推断讲完。',
    requires: () =>
      S.clues.extraStar &&
      S.clues.drawingMatch &&
      S.clues.keyLog &&
      S.clues.curatorScript,
    reply: () => {
      S.truthRevealed = true;
      S.stage = 3;
      return '……是的。小满住院半年了,老馆长想让她画的那颗星,真的出现在博物馆的星图上。我们只是想给她一个惊喜。';
    },
    onAsk: () => {
      S.truthRevealed = true;
      S.stage = 3;
    },
  },
];

const LOCK_HINT = {
  t_key: '先去左手边的钥匙柜,打开抽屉看看借用登记。',
  t_truth: '线索还不齐:投影多出的星、玻璃反光星点、画与投影对齐、钥匙借用记录、老馆长讲解稿——全部到手再下结论。',
};

const SCENE = {
  spotlight: { x: 340, y: 78, r: 24 },
  starMap: { x: 480, y: 196, r: 48 },
  displayCase: { x: 480, y: 330, w: 160, h: 140 },
  cabinet: { x: 140, y: 352, w: 86, h: 118 },
  lectern: { x: 810, y: 338, w: 88, h: 74 },
  npc: { x: 620, y: 415, r: 52 },
  bench: { x: 790, y: 480 },
  drawingHome: { x: 790, y: 456 },
  drawingPlacedPos: { x: 585, y: 338 },
};

let drawing = { x: SCENE.drawingHome.x, y: SCENE.drawingHome.y, w: 52, h: 38 };
let endingWarm = false;
let matchAnimAt = 0;
let hover = null;
let introActive = true;
let storyPlaying = false;
let npcSayText = '';
let npcSayAt = 0;
let allCluesNoted = false;

const stats = { turns: 0, events: 0 };

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

const ceilingStars = Array.from({ length: 110 }, () => ({
  x: Math.random() * 960,
  y: Math.random() * 152,
  r: Math.random() * 1.5 + 0.4,
  p: Math.random() * Math.PI * 2,
  warm: Math.random() < 0.18,
}));

const mapStars = Array.from({ length: 11 }, (_, i) => ({
  r: 12 + ((i * 37) % 30),
  a: (i * 2.399963) % (Math.PI * 2),
  s: 1 + (i % 3) * 0.4,
}));

const EXTRA_STAR_TARGET_ANGLE = 1.71;
const EXTRA_STAR_RADIUS = 36;

function extraStarAngle() {
  return EXTRA_STAR_TARGET_ANGLE - ALIGNED_PROJ * 0.45 + S.projAngle * 0.45;
}

const cam = { x: 0, y: 0, tx: 0, ty: 0 };
const starFx = [];
let litTrail = [];

const backBtn = document.getElementById('back-btn');

const view = { x: 480, y: 320, zoom: 1, tx: 480, ty: 320, tzoom: 1, focus: null };
let zoomDetail = false;

const FOCUS = {
  spotlight: { x: 340, y: 122, zoom: 2.7 },
  starMap: { x: 480, y: 212, zoom: 2.4 },
  case: { x: 480, y: 336, zoom: 2.2 },
  cabinet: { x: 142, y: 356, zoom: 2.5 },
  lectern: { x: 810, y: 344, zoom: 2.5 },
  npc: { x: 620, y: 402, zoom: 2.2 },
  drawing: {
    get x() {
      return drawing.x;
    },
    get y() {
      return drawing.y + 18;
    },
    zoom: 2.8,
  },
};

const FOCUS_LABELS = {
  spotlight: '聚光灯',
  starMap: '全息星图',
  case: '主展柜 · 琥珀',
  cabinet: '钥匙柜',
  lectern: '讲解台',
  npc: '林晚',
  drawing: '小满的儿童画',
};

const FOCUS_HINTS = {
  spotlight: '点击灯体循环角度,或点下方刻度条直接选择',
  starMap: '点击星图或两侧箭头旋转',
  case: '琥珀在灯光里轻轻呼吸',
  cabinet: '点击抽屉开合',
  lectern: '点击稿纸阅读最后一行',
  npc: '用右侧对话选项向林晚提问',
  drawing: '画上那颗暖色的星,和投影里多出来的那颗很像',
};

function worldPoint(e) {
  const pt = toCanvasPoint(e);
  return {
    x: (pt.x - 480) / view.zoom + view.x,
    y: (pt.y - 320) / view.zoom + view.y,
  };
}

function worldToScreen(wx, wy) {
  return {
    x: (wx - view.x) * view.zoom + 480,
    y: (wy - view.y) * view.zoom + 320,
  };
}

function focusObject(id) {
  const f = FOCUS[id];
  if (!f) return;
  view.focus = id;
  view.tx = f.x;
  view.ty = f.y;
  view.tzoom = f.zoom;
  backBtn.classList.remove('hidden');
}

function zoomOut() {
  view.focus = null;
  view.tx = 480;
  view.ty = 320;
  view.tzoom = 1;
  backBtn.classList.add('hidden');
}

function toCanvasPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * canvas.width,
    y: ((e.clientY - rect.top) / rect.height) * canvas.height,
  };
}

function inRect(pt, r) {
  return (
    pt.x >= r.x - r.w / 2 &&
    pt.x <= r.x + r.w / 2 &&
    pt.y >= r.y - r.h / 2 &&
    pt.y <= r.y + r.h / 2
  );
}

function hitTest(pt) {
  if (
    Math.abs(pt.x - drawing.x) <= drawing.w / 2 + 8 &&
    Math.abs(pt.y - drawing.y) <= drawing.h / 2 + 8
  ) {
    return 'drawing';
  }
  if (Math.hypot(pt.x - SCENE.spotlight.x, pt.y - SCENE.spotlight.y) <= SCENE.spotlight.r + 10) {
    return 'spotlight';
  }
  if (Math.hypot(pt.x - SCENE.starMap.x, pt.y - SCENE.starMap.y) <= SCENE.starMap.r + 10) {
    return 'starMap';
  }
  if (inRect(pt, SCENE.cabinet)) return 'cabinet';
  if (inRect(pt, SCENE.lectern)) return 'lectern';
  if (inRect(pt, SCENE.displayCase)) return 'case';
  if (Math.hypot(pt.x - SCENE.npc.x, pt.y - SCENE.npc.y) <= SCENE.npc.r + 10) return 'npc';
  return null;
}

function findStar(pt) {
  const px = pt.x - cam.x * 0.5;
  const py = pt.y - cam.y * 0.5;
  let best = null;
  let bestD = 15;
  for (const s of ceilingStars) {
    const d = Math.hypot(px - s.x, py - s.y);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

let pointer = { down: false, obj: null, sx: 0, sy: 0, dx: 0, dy: 0 };

canvas.addEventListener('pointerdown', (e) => {
  if (introActive || storyPlaying) return;
  const pt = worldPoint(e);
  const obj = hitTest(pt);
  pointer = { down: true, obj, sx: e.clientX, sy: e.clientY, dx: 0, dy: 0 };
  if (obj === 'drawing' && !S.drawingPlaced) {
    pointer.dx = drawing.x - pt.x;
    pointer.dy = drawing.y - pt.y;
  }
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {}
});

canvas.addEventListener('pointermove', (e) => {
  if (introActive || storyPlaying) return;
  const raw = toCanvasPoint(e);
  const pt = worldPoint(e);
  if (pointer.down && pointer.obj === 'drawing' && !S.drawingPlaced) {
    drawing.x = clamp(pt.x + pointer.dx, 40, 920);
    drawing.y = clamp(pt.y + pointer.dy, 60, 600);
  }
  cam.tx = ((raw.x - 480) / 480) * 7;
  cam.ty = ((raw.y - 320) / 320) * 5;
  hover = hitTest(pt);
  const onControl = view.focus && focusControlHit(pt);
  canvas.style.cursor = onControl
    ? 'pointer'
    : hover
      ? hover === 'drawing' && !S.drawingPlaced
        ? 'grab'
        : 'pointer'
      : !view.focus && raw.y < 160 && findStar(pt)
        ? 'pointer'
        : 'default';
});

canvas.addEventListener('pointerup', (e) => {
  if (!pointer.down) return;
  const obj = pointer.obj;
  const dragDist = Math.abs(e.clientX - pointer.sx) + Math.abs(e.clientY - pointer.sy);
  pointer.down = false;
  pointer.obj = null;

  const pt = worldPoint(e);

  if (obj === 'drawing') {
    if (dragDist > 6) {
      if (!S.drawingPlaced) onDropDrawing();
      return;
    }
    handleObjClick('drawing', pt);
    return;
  }
  if (dragDist > 6) return;

  if (view.focus) {
    const ctl = focusControlHit(pt);
    if (ctl) {
      ctl();
      return;
    }
  }

  if (obj) {
    handleObjClick(obj, pt);
    return;
  }

  if (view.focus) {
    zoomOut();
    return;
  }

  const raw = toCanvasPoint(e);
  if (raw.y < 160) {
    const star = findStar(pt);
    if (star) clickStar(star);
  }
});

function handleObjClick(obj, world) {
  if (!view.focus) {
    focusObject(obj);
    return;
  }
  if (obj === view.focus) {
    const action = FOCUS_ACTION[obj];
    if (action) action(world);
    return;
  }
  focusObject(obj);
}

const FOCUS_ACTION = {
  spotlight: () => clickSpotlight(),
  starMap: () => clickStarMap(),
  cabinet: () => clickCabinet(),
  lectern: () => clickLectern(),
  npc: () => {
    npcSay('有什么想问的,点右边的对话选项,或者直接打字告诉我也行。');
  },
  case: () => {
    starFx.push({ x: SCENE.displayCase.x, y: 318, at: performance.now() });
  },
  drawing: () => {
    npcSay('这是小满画的星图。她说,等病好了,要亲自来认领那颗暖色的星。');
  },
};

function focusControlHit(pt) {
  if (view.focus === 'spotlight') {
    const bar = { x: 340, y: 182, w: 240, h: 36 };
    if (inRect(pt, bar)) {
      const i = Math.floor((pt.x - (bar.x - bar.w / 2)) / (bar.w / 3));
      return () => setLightAngle(clamp(i, 0, 2));
    }
  }
  if (view.focus === 'starMap') {
    if (Math.hypot(pt.x - (480 - 88), pt.y - 212) <= 18) return () => rotateProj(-1);
    if (Math.hypot(pt.x - (480 + 88), pt.y - 212) <= 18) return () => rotateProj(1);
  }
  return null;
}

function clickStar(star) {
  starFx.push({ x: star.x, y: star.y, at: performance.now() });
  star.hl = performance.now();
  litTrail.push({ x: star.x, y: star.y, at: performance.now() });
  if (litTrail.length > 7) litTrail.shift();
}

function setLightAngle(i) {
  if (S.truthRevealed) return;
  S.lightAngle = i;
  if (S.lightAngle === ALIGNED_LIGHT) {
    giveClue('glassReflection', '聚光灯调到正中——展柜玻璃上浮出一片细小的反光星点,像是有人特意调过角度。');
  }
}

function rotateProj(dir) {
  if (S.truthRevealed) return;
  S.projAngle = (S.projAngle + dir + 3) % 3;
  if (S.projAngle === ALIGNED_PROJ) {
    giveClue('extraStar', '星图转到特别的角度:多出的那颗暖色星,恰好和儿童画上的星位对上了。');
  }
}

function clickSpotlight() {
  setLightAngle((S.lightAngle + 1) % 3);
}

function clickStarMap() {
  rotateProj(1);
}

function clickCabinet() {
  if (S.truthRevealed) return;
  S.cabinetOpen = !S.cabinetOpen;
  if (S.cabinetOpen) {
    giveClue('keyLog', '借用登记卡:19:42,周叔借出「主展柜钥匙」一把,备注——馆长特别交代。');
  }
}

function clickLectern() {
  if (S.truthRevealed) return;
  S.scriptRead = true;
  giveClue('curatorScript', '讲解稿最后一页是老馆长的字:「那颗暖色的星,留给一个会画星星的小朋友。」');
}

function onDropDrawing() {
  if (S.truthRevealed) return;
  const near =
    Math.hypot(drawing.x - SCENE.displayCase.x, drawing.y - SCENE.displayCase.y) < 160;
  if (near) {
    drawing.x = SCENE.drawingPlacedPos.x;
    drawing.y = SCENE.drawingPlacedPos.y;
    S.drawingPlaced = true;
    stats.events += 1;
    addMessage('system', '事件', '你把儿童画放到了展柜旁,投影与画作现在可以对照了。');
    pushHistory('event', '把儿童画拖到了展柜旁');
    checkDerived();
    if (!S.clues.drawingMatch) {
      addMessage('system', '提示', '画和投影似乎还差一点对上——试试调整聚光灯与星图的角度。');
    }
  } else {
    drawing.x = SCENE.drawingHome.x;
    drawing.y = SCENE.drawingHome.y;
  }
  updateAll();
  saveProfile('事件已同步');
}

function giveClue(id, note) {
  if (S.clues[id]) return false;
  S.clues[id] = true;
  addMessage('clue', '线索', `${CLUE_META[id]} —— ${note}`);
  pushHistory('clue', `获得线索:${CLUE_META[id]}`);

  const story = STORY[id];
  if (story) {
    addMessage('story', `故事 · ${story.title}`, story.text);
    pushHistory('story', `${story.title}:${story.text}`);
  }

  checkDerived();
  stats.events += 1;
  updateAll();
  saveProfile('线索已同步');
  return true;
}

function checkDerived() {
  if (Object.values(S.clues).some(Boolean) && S.stage === 0) {
    S.stage = 1;
    addMessage('story', '旁白', '闭馆的星尘厅里,雨声忽然小了。像是有什么东西,正等你发现。');
  }
  if (
    S.drawingPlaced &&
    S.clues.glassReflection &&
    S.clues.extraStar &&
    !S.clues.drawingMatch
  ) {
    const granted = giveClueSilent('drawingMatch');
    if (granted) {
      matchAnimAt = performance.now();
      addMessage('clue', '线索', '画与投影对齐:玻璃上的反光星点,正是儿童画上那颗星的位置——这颗星确实是后来画上去的。');
      pushHistory('clue', '获得线索:画与投影对齐');
      if (STORY.drawingMatch) {
        addMessage('story', `故事 · ${STORY.drawingMatch.title}`, STORY.drawingMatch.text);
        pushHistory('story', `${STORY.drawingMatch.title}:${STORY.drawingMatch.text}`);
      }
      npcSay('你注意到了呀……那张画,就放在休息区的桌上。');
    }
  }
  if (countClues() === 5 && !allCluesNoted) {
    allCluesNoted = true;
    S.stage = Math.max(S.stage, 2);
    addMessage('story', '旁白', '所有线索都指向同一个温柔的答案。星尘厅安静得能听见雨点敲在穹顶上的声音。是时候,把推断告诉林晚了。');
  }
  updateAll();
}

function giveClueSilent(id) {
  if (S.clues[id]) return false;
  S.clues[id] = true;
  return true;
}

function askTopic(topicId) {
  if (introActive || storyPlaying) return;
  const t = topics.find((x) => x.id === topicId);
  if (!t || S.stage >= 4) return;
  if (t.requires && !t.requires()) {
    addMessage('system', '提示', LOCK_HINT[topicId] ?? '还不够格问这个。');
    return;
  }
  if (!S.pressedTopics.includes(topicId)) S.pressedTopics.push(topicId);
  S.stage = Math.max(S.stage, 2);

  const line = t.reply();
  addMessage('npc', '林晚', line);
  npcSay(line);
  pushHistory('npc', line);
  stats.turns += 1;
  if (t.onAsk) t.onAsk();
  updateAll();
  saveProfile('对话已同步');

  if (topicId === 't_truth' && S.truthRevealed) {
    setTimeout(startEnding, 1600);
  }
}

function startEnding() {
  if (endingWarm) return;
  endingWarm = true;
  S.stage = 4;
  stats.events += 1;
  npcSay('……谢谢你,愿意听完这个故事。');
  addMessage('system', '结局', '真相还原:这是一场为小满准备的闭馆惊喜。穹顶上,那颗暖色的星被正式点亮。');
  pushHistory('event', '真相还原:星尘琥珀是一场善意的惊喜计划');
  updateAll();
  saveProfile('结局已同步');

  storyPlaying = true;
  setTimeout(() => {
    playSequence(EPILOGUE_LINES, '旁白', () => {
      storyPlaying = false;
      certModal.classList.remove('hidden');
    });
  }, 2200);
}

function resetAll() {
  S = freshState();
  drawing = { x: SCENE.drawingHome.x, y: SCENE.drawingHome.y, w: 52, h: 38 };
  endingWarm = false;
  matchAnimAt = 0;
  npcSayText = '';
  npcSayAt = 0;
  allCluesNoted = false;
  starFx.length = 0;
  litTrail = [];
  zoomOut();
  certModal.classList.add('hidden');
  addMessage('system', 'system', '新的一轮闭馆调试开始了。');
  npcSay('要再来一遍吗?这次,我会把知道的都告诉你。');
  updateAll();
  saveProfile('已重置');
}

function countClues() {
  return Object.values(S.clues).filter(Boolean).length;
}

const OBJECTIVE_STEPS = [
  { key: 'spotlight', text: '把头顶的聚光灯调到「正中」', done: () => S.clues.glassReflection },
  { key: 'starMap', text: '转动全息星图,找到对齐的角度', done: () => S.clues.extraStar },
  { key: 'drawing', text: '把儿童画拖到展柜旁,和投影对照', done: () => S.clues.drawingMatch },
  { key: 'cabinet', text: '打开钥匙柜,看看借用登记', done: () => S.clues.keyLog },
  { key: 'lectern', text: '读一读讲解稿的最后一行', done: () => S.clues.curatorScript },
  {
    key: 'npc',
    text: '去和林晚聊聊你的发现',
    done: () => S.pressedTopics.includes('t_projection') || S.pressedTopics.includes('t_light'),
  },
  { key: 'npc', text: '线索齐了——把推断告诉林晚', done: () => S.stage >= 4 },
];

function nextObjective() {
  return OBJECTIVE_STEPS.find((s) => !s.done()) ?? null;
}

function updateAll() {
  buildClueBar();
  buildTopicBar();
  updateProfileChip('');
  updateObjective();
}

function updateObjective() {
  if (introActive) {
    objectiveEl.textContent = '目标:先听听林晚说些什么';
    return;
  }
  const obj = nextObjective();
  objectiveEl.textContent = obj ? `目标:${obj.text}` : '目标:故事已经讲完,点「重新参观」可以再来一次。';
}

function buildClueBar() {
  clueBar.innerHTML = '';
  for (const [id, label] of Object.entries(CLUE_META)) {
    const el = document.createElement('span');
    el.className = `clue-chip${S.clues[id] ? ' got' : ''}`;
    el.textContent = `${S.clues[id] ? '●' : '○'} ${label}`;
    clueBar.append(el);
  }
}

function buildTopicBar() {
  topicBar.innerHTML = '';
  for (const t of topics) {
    const unlocked = !t.requires || t.requires();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className =
      'topic-btn' +
      (unlocked ? '' : ' locked') +
      (S.pressedTopics.includes(t.id) ? ' asked' : '');
    btn.textContent = t.label + (unlocked ? '' : ' · 现在还问不出口');
    btn.disabled = introActive || storyPlaying || !unlocked || S.stage >= 4;
    if (!unlocked && LOCK_HINT[t.id]) btn.title = LOCK_HINT[t.id];
    btn.addEventListener('click', () => askTopic(t.id));
    topicBar.append(btn);
  }
}

function captureImage() {
  return canvas.toDataURL('image/jpeg', SHOT_QUALITY);
}

function addMessage(cls, label, text, raw) {
  const div = document.createElement('div');
  div.className = `msg ${cls}`;

  const labelEl = document.createElement('div');
  labelEl.className = 'label';
  labelEl.textContent = label;

  const body = document.createElement('div');
  body.className = 'body';
  body.textContent = text;

  div.append(labelEl, body);

  if (raw) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = '原始响应';
    const pre = document.createElement('pre');
    pre.textContent = raw;
    details.append(summary, pre);
    div.append(details);
  }

  chatLog.append(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div;
}

function setBusy(busy, note = '') {
  sendBtn.disabled = busy;
  statusEl.textContent = note;
}

const history = [];

function pushHistory(role, text) {
  history.push({ role, text, at: new Date().toISOString() });
  if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
}

function updateProfileChip(note) {
  profileChip.textContent =
    `画像 #${playerId.slice(0, 6)} · 轮次 ${stats.turns} · 线索 ${countClues()}/5` +
    (note ? ` · ${note}` : '');
}

async function loadProfile() {
  try {
    const res = await fetch(`${PROFILE_URL}/${playerId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data) {
      if (data.stats) {
        stats.turns = data.stats.turns ?? 0;
        stats.events = data.stats.events ?? 0;
      }
      if (data.model) modelChip.textContent = `model: ${data.model}`;
      updateProfileChip('已加载');
    } else {
      updateProfileChip('新玩家');
    }
  } catch {
    updateProfileChip('离线模式');
  }
}

async function saveProfile(note) {
  try {
    await fetch(`${PROFILE_URL}/${playerId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stats,
        stage: S.stage,
        trust: S.trust,
        clues: S.clues,
        pressedTopics: S.pressedTopics,
        scene: '星尘琥珀·闭馆谜题',
      }),
    });
    updateProfileChip(note);
  } catch {
    updateProfileChip('同步失败');
  }
}

function npcSay(text) {
  npcSayText = String(text).slice(0, 140);
  npcSayAt = performance.now();
}

composer.addEventListener('submit', async (e) => {
  e.preventDefault();

  const text = input.value.trim();
  if (!text || sendBtn.disabled || introActive || storyPlaying) return;

  input.value = '';
  addMessage('player', '你', text);
  pushHistory('player', text);
  stats.turns += 1;
  setBusy(true, '林晚思考中…');

  const obtainedClues = Object.entries(S.clues)
    .filter(([, v]) => v)
    .map(([k]) => CLUE_META[k]);

  const body = {
    imageBase64: captureImage(),
    text: `${text}\n\n${DIRECTOR_RULES}`,
    stateJson: {
      scene: '星尘琥珀·闭馆谜题',
      playerId,
      npc: { name: '林晚', x: SCENE.npc.x, y: SCENE.npc.y },
      state: S,
      obtainedClues,
      drawing: { x: Math.round(drawing.x), y: Math.round(drawing.y), placed: S.drawingPlaced },
      stats,
      history,
    },
  };

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      addMessage('error', `HTTP ${res.status}`, data?.error ?? JSON.stringify(data));
      return;
    }

    const reply = data?.choices?.[0]?.message?.content ?? '(空回复)';
    if (data?.model) modelChip.textContent = `model: ${data.model}`;

    const parsed = parseMinigame(reply);
    const msgEl = addMessage('npc', '林晚', parsed.prose, JSON.stringify(data, null, 2));
    if (parsed.code) attachLaunchButton(msgEl, parsed.code);
    npcSay(parsed.prose);
    pushHistory('npc', parsed.prose);
  } catch (err) {
    addMessage('error', '请求失败', String(err));
  } finally {
    setBusy(false, '');
    input.focus();
    saveProfile('对话已同步');
  }
});

let activeGame = null;
let readyTimer = null;

function parseMinigame(reply) {
  const m = reply.match(/<minigame>([\s\S]*?)<\/minigame>/i);
  if (!m) return { prose: reply.trim(), code: null };
  let code = m[1].trim();
  code = code
    .replace(/^```(?:html|javascript|js)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const prose = reply.replace(m[0], '').trim();
  return {
    prose: prose || '(模型生成了一个线索小游戏,点击下方按钮开始。)',
    code: code || null,
  };
}

function wrapMinigame(code) {
  const stamp = `/* mg-${Date.now()} */`;
  const csp =
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:;">`;
  const bridge = `<script>${stamp}parent.postMessage({source:'minigame',type:'ready'},'*');</script>`;
  const base = `<meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#10141b;color:#e8ecf3;font-family:"Microsoft YaHei","Segoe UI",sans-serif;}
    *{box-sizing:border-box;}
    body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;}
    button{cursor:pointer;background:#7c5cff;color:#fff;border:none;border-radius:8px;padding:9px 20px;font-size:14px;}
  </style>`;

  let doc = String(code).trim();
  if (/<head[^>]*>/i.test(doc)) {
    doc = doc.replace(/<head[^>]*>/i, (m) => `${m}${base}${csp}${bridge}`);
  } else if (/<html[^>]*>/i.test(doc)) {
    doc = doc.replace(/<html[^>]*>/i, (m) => `${m}<head>${base}${csp}${bridge}</head>`);
  } else {
    doc = `<!DOCTYPE html><html><head>${base}${csp}${bridge}</head><body>${doc}</body></html>`;
  }
  return doc;
}

function attachLaunchButton(msgEl, code) {
  const btn = document.createElement('button');
  btn.className = 'launch';
  btn.type = 'button';
  btn.textContent = '启动线索小游戏';
  btn.addEventListener('click', () => launchMinigame(code));
  msgEl.append(btn);
}

function launchMinigame(code) {
  if (!code) return;
  if (code.length > 200000) {
    addMessage('error', '小游戏', '模型生成的小游戏代码过大(>200KB),已忽略。');
    return;
  }
  activeGame = { code };
  minigameModal.classList.remove('hidden');
  minigameStatus.textContent = '加载中…';
  minigameFrame.srcdoc = wrapMinigame(code);
  readyTimer = setTimeout(() => {
    if (minigameStatus.textContent === '加载中…') {
      minigameStatus.textContent = '加载超时,可尝试重新开始';
    }
  }, 20000);
}

function closeModal() {
  minigameModal.classList.add('hidden');
  minigameFrame.srcdoc = '';
  clearTimeout(readyTimer);
  activeGame = null;
}

function finishMinigame(success) {
  closeModal();
  stats.events += 1;
  addMessage('system', '事件', `线索小游戏${success ? '成功通关' : '未通关'},结果已记入进度,下次对话会告知林晚。`);
  pushHistory('event', `小游戏结果:${success ? '通关' : '失败'}`);
  saveProfile('小游戏结果已同步');
}

window.addEventListener('message', (e) => {
  if (!activeGame || e.source !== minigameFrame.contentWindow) return;
  const data = e.data;
  if (!data || data.source !== 'minigame') return;
  if (data.type === 'ready') {
    clearTimeout(readyTimer);
    minigameStatus.textContent = '已就绪';
  } else if (data.type === 'complete') {
    finishMinigame(data.success !== false);
  }
});

minigameClose.addEventListener('click', closeModal);
minigameRestart.addEventListener('click', () => {
  if (!activeGame) return;
  minigameStatus.textContent = '加载中…';
  minigameFrame.srcdoc = wrapMinigame(activeGame.code);
});
certRestart.addEventListener('click', resetAll);
backBtn.addEventListener('click', zoomOut);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && view.focus) zoomOut();
});

let seqLines = [];
let seqIndex = 0;
let seqTyping = false;
let seqTimer = null;
let seqDone = null;

function playSequence(lines, name, done) {
  seqLines = lines;
  seqIndex = 0;
  seqDone = done || null;
  introNameEl.textContent = name;
  introEl.classList.remove('hidden');
  typeSeqLine();
}

function typeSeqLine() {
  const text = seqLines[seqIndex];
  introText.textContent = '';
  seqTyping = true;
  introNext.textContent = '继续';
  let i = 0;
  clearInterval(seqTimer);
  seqTimer = setInterval(() => {
    i += 1;
    introText.textContent = text.slice(0, i);
    if (i >= text.length) {
      clearInterval(seqTimer);
      seqTyping = false;
    }
  }, 28);
}

function seqNext() {
  if (seqTyping) {
    clearInterval(seqTimer);
    seqTyping = false;
    introText.textContent = seqLines[seqIndex];
    return;
  }
  seqIndex += 1;
  if (seqIndex >= seqLines.length) {
    endSequence();
    return;
  }
  typeSeqLine();
}

function endSequence() {
  clearInterval(seqTimer);
  introEl.classList.add('hidden');
  const cb = seqDone;
  seqDone = null;
  seqLines = [];
  if (cb) cb();
}

introNext.addEventListener('click', seqNext);
introSkip.addEventListener('click', endSequence);

function onIntroFinished() {
  introActive = false;
  npcSay('先从头顶的聚光灯开始吧——把它调到正中,看看玻璃上会有什么。');
  updateAll();
}

function render(t) {
  cam.x += (cam.tx - cam.x) * 0.06;
  cam.y += (cam.ty - cam.y) * 0.06;
  view.x += (view.tx - view.x) * 0.12;
  view.y += (view.ty - view.y) * 0.12;
  view.zoom += (view.tzoom - view.zoom) * 0.1;
  zoomDetail = view.zoom > 1.4;

  const bg = ctx.createLinearGradient(0, 0, 0, 640);
  if (endingWarm) {
    bg.addColorStop(0, '#3a2c1a');
    bg.addColorStop(1, '#171008');
  } else {
    bg.addColorStop(0, '#1b2650');
    bg.addColorStop(1, '#0b0f1e');
  }
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 960, 640);

  ctx.save();
  ctx.translate(480, 320);
  ctx.scale(view.zoom, view.zoom);
  ctx.translate(-view.x, -view.y);

  drawCeiling(t);
  drawRoom(t);
  drawSconces(t);
  drawSpotlight(t);
  drawStarMap(t);
  drawDisplayCase(t);
  drawCabinet(t);
  drawLectern(t);
  drawBench(t);
  drawDrawing(t);
  drawNpc(t);
  drawStarEffects(t);
  drawFocusControls(t);
  if (endingWarm) drawMemorialStar(t);

  ctx.restore();

  drawBubble(t);
  drawObjectivePulse(t);
  drawVignette();
  drawFocusOverlay(t);
}

function pulse(t, speed = 450, base = 0.35, amp = 0.25) {
  return base + amp * (0.5 + 0.5 * Math.sin(t / speed));
}

function drawCeiling(t) {
  const ox = cam.x * 0.5;
  const oy = cam.y * 0.4;

  for (const s of ceilingStars) {
    const tw = 0.45 + 0.4 * Math.sin(t / 750 + s.p);
    ctx.globalAlpha = Math.max(0.12, tw);
    ctx.fillStyle = s.warm ? '#ffd98a' : '#e8efff';
    ctx.beginPath();
    ctx.arc(s.x + ox, s.y + oy, s.r, 0, Math.PI * 2);
    ctx.fill();

    const hl = performance.now() - (s.hl ?? 0);
    if (hl < 2600) {
      const a = 1 - hl / 2600;
      const g = ctx.createRadialGradient(s.x + ox, s.y + oy, 0, s.x + ox, s.y + oy, 18);
      g.addColorStop(0, `rgba(255,224,160,${0.5 * a})`);
      g.addColorStop(1, 'rgba(255,224,160,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s.x + ox, s.y + oy, 18, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  const drift = (t / 70) % 1200 - 120;
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = '#fff8e6';
  ctx.beginPath();
  ctx.arc(drift, 46 + Math.sin(drift / 60) * 10, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.strokeStyle = 'rgba(200, 215, 255, 0.1)';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 3; i++) {
    ctx.beginPath();
    ctx.ellipse(480 + ox, 155 + oy, 190 * i, 52 * i, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
  }

  const band = ctx.createLinearGradient(0, 0, 960, 160);
  band.addColorStop(0, 'rgba(90,130,255,0.06)');
  band.addColorStop(0.5, 'rgba(200,215,255,0.1)');
  band.addColorStop(1, 'rgba(90,130,255,0.05)');
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, 960, 160);

  const cove = ctx.createLinearGradient(0, 90, 0, 165);
  cove.addColorStop(0, 'rgba(255,214,150,0)');
  cove.addColorStop(1, 'rgba(255,214,150,0.14)');
  ctx.fillStyle = cove;
  ctx.fillRect(160, 90, 640, 75);

  const trail = litTrail.filter((p) => performance.now() - p.at < 7000);
  litTrail = trail;
  if (trail.length > 1) {
    ctx.strokeStyle = 'rgba(255,224,160,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    trail.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x + ox, p.y + oy);
      else ctx.lineTo(p.x + ox, p.y + oy);
    });
    ctx.stroke();
    for (const p of trail) {
      ctx.fillStyle = 'rgba(255,224,160,0.5)';
      ctx.beginPath();
      ctx.arc(p.x + ox, p.y + oy, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawRoom(t) {
  const wallTop = 150;
  const wallBottom = 400;

  ctx.fillStyle = '#232c4d';
  ctx.beginPath();
  ctx.moveTo(200, wallTop);
  ctx.lineTo(760, wallTop);
  ctx.lineTo(760, wallBottom);
  ctx.lineTo(200, wallBottom);
  ctx.closePath();
  ctx.fill();

  const wash = ctx.createLinearGradient(0, wallTop, 0, wallBottom);
  wash.addColorStop(0, 'rgba(255,214,150,0.10)');
  wash.addColorStop(0.5, 'rgba(140,160,220,0.05)');
  wash.addColorStop(1, 'rgba(10,14,26,0.25)');
  ctx.fillStyle = wash;
  ctx.fillRect(200, wallTop, 560, wallBottom - wallTop);

  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let x = 260; x < 760; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x, wallTop);
    ctx.lineTo(x, wallBottom);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(245,176,66,0.22)';
  ctx.strokeRect(330, 178, 300, 132);

  ctx.fillStyle = 'rgba(240,240,250,0.5)';
  ctx.font = '13px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('星 尘 厅 · 常 设 展', 480, 214);

  const leftWall = ctx.createLinearGradient(0, 0, 200, 400);
  leftWall.addColorStop(0, '#1d2542');
  leftWall.addColorStop(1, '#26304f');
  ctx.fillStyle = leftWall;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(200, wallTop);
  ctx.lineTo(200, wallBottom);
  ctx.lineTo(0, 640);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#26304f';
  ctx.beginPath();
  ctx.moveTo(960, 0);
  ctx.lineTo(760, wallTop);
  ctx.lineTo(760, wallBottom);
  ctx.lineTo(960, 640);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,255,0.055)';
  const seamL = [
    [200, 180, 0, 120],
    [200, 240, 0, 230],
    [200, 300, 0, 345],
    [200, 358, 0, 460],
  ];
  for (const [x1, y1, x2, y2] of seamL) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(960 - x1, y1);
    ctx.lineTo(960 - x2, y2);
    ctx.stroke();
  }

  for (const cx of [222, 738]) {
    const col = ctx.createLinearGradient(cx - 10, 0, cx + 10, 0);
    col.addColorStop(0, '#1a2140');
    col.addColorStop(0.5, '#37426e');
    col.addColorStop(1, '#1a2140');
    ctx.fillStyle = col;
    ctx.fillRect(cx - 9, wallTop, 18, wallBottom - wallTop);
    ctx.fillStyle = '#455184';
    ctx.fillRect(cx - 12, wallTop - 6, 24, 7);
  }

  const floor = ctx.createLinearGradient(0, wallBottom, 0, 640);
  floor.addColorStop(0, '#1a2340');
  floor.addColorStop(0.5, '#141a30');
  floor.addColorStop(1, '#0a0e1a');
  ctx.fillStyle = floor;
  ctx.beginPath();
  ctx.moveTo(200, wallBottom);
  ctx.lineTo(760, wallBottom);
  ctx.lineTo(960, 640);
  ctx.lineTo(0, 640);
  ctx.closePath();
  ctx.fill();

  const refl = ctx.createRadialGradient(480, 415, 10, 480, 415, 240);
  refl.addColorStop(0, endingWarm ? 'rgba(245,176,66,0.22)' : 'rgba(245,176,66,0.13)');
  refl.addColorStop(1, 'rgba(245,176,66,0)');
  ctx.fillStyle = refl;
  ctx.beginPath();
  ctx.ellipse(480, 430, 220, 90, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 6; i++) {
    const y = wallBottom + (240 * i * i) / 36;
    const inset = ((y - wallBottom) / 240) * 200;
    ctx.beginPath();
    ctx.moveTo(200 - inset, y);
    ctx.lineTo(760 + inset, y);
    ctx.stroke();
  }
  for (let x = -320; x <= 1280; x += 140) {
    ctx.beginPath();
    ctx.moveTo(480, wallBottom);
    ctx.lineTo(x, 640);
    ctx.stroke();
  }
}

function drawSconces(t) {
  for (const [x, y] of [
    [262, 200],
    [698, 200],
  ]) {
    const g = ctx.createRadialGradient(x, y, 2, x, y, 52);
    g.addColorStop(0, `rgba(255,205,130,${0.35 + 0.05 * Math.sin(t / 900 + x)})`);
    g.addColorStop(1, 'rgba(255,205,130,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 52, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffe0a8';
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,224,168,0.4)';
    ctx.beginPath();
    ctx.moveTo(x, y + 6);
    ctx.lineTo(x, y + 18);
    ctx.stroke();
  }
}

function drawSpotlight(t) {
  const s = SCENE.spotlight;
  ctx.strokeStyle = 'rgba(160,175,210,0.4)';
  ctx.beginPath();
  ctx.moveTo(s.x, 0);
  ctx.lineTo(s.x, s.y - 14);
  ctx.stroke();

  const base = Math.atan2(320 - s.y, SCENE.displayCase.x - s.x);
  const dir = base + (S.lightAngle - 1) * 0.14;
  const len = 300;
  const spread = 0.1;

  const cone = ctx.createLinearGradient(s.x, s.y, s.x + Math.cos(dir) * len, s.y + Math.sin(dir) * len);
  cone.addColorStop(0, 'rgba(255,244,214,0.4)');
  cone.addColorStop(1, 'rgba(255,244,214,0.03)');
  ctx.fillStyle = cone;
  ctx.beginPath();
  ctx.moveTo(s.x, s.y);
  ctx.lineTo(s.x + Math.cos(dir - spread) * len, s.y + Math.sin(dir - spread) * len);
  ctx.lineTo(s.x + Math.cos(dir + spread) * len, s.y + Math.sin(dir + spread) * len);
  ctx.closePath();
  ctx.fill();

  ctx.save();
  ctx.shadowColor = 'rgba(255,244,214,0.7)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = '#e6dfc8';
  ctx.beginPath();
  ctx.roundRect(s.x - 14, s.y - 10, 28, 20, 5);
  ctx.fill();
  ctx.restore();

  if (zoomDetail) {
    ctx.strokeStyle = 'rgba(120,110,90,0.8)';
    ctx.lineWidth = 1.2;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(s.x - 13, s.y - 6 + i * 5);
      ctx.lineTo(s.x - 4, s.y - 6 + i * 5);
      ctx.stroke();
    }
    const lens = ctx.createRadialGradient(s.x + 4, s.y + 2, 1, s.x + 4, s.y + 2, 9);
    lens.addColorStop(0, 'rgba(255,250,230,0.95)');
    lens.addColorStop(1, 'rgba(255,244,200,0.15)');
    ctx.fillStyle = lens;
    ctx.beginPath();
    ctx.arc(s.x + 4, s.y + 2, 9, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,224,168,0.4)';
    ctx.beginPath();
    ctx.arc(s.x, s.y, 34, base - 0.5, base + 0.5);
    ctx.stroke();
    for (let k = -2; k <= 2; k++) {
      const a = base + k * 0.25;
      ctx.beginPath();
      ctx.moveTo(s.x + Math.cos(a) * 30, s.y + Math.sin(a) * 30);
      ctx.lineTo(s.x + Math.cos(a) * 36, s.y + Math.sin(a) * 36);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,217,138,0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x + Math.cos(dir) * 28, s.y + Math.sin(dir) * 28);
    ctx.stroke();
  }

  if (hover === 'spotlight' && !S.truthRevealed) {
    ctx.strokeStyle = `rgba(245,176,66,${pulse(t)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 26, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawStarMap(t) {
  const m = SCENE.starMap;

  ctx.save();
  ctx.strokeStyle = endingWarm ? 'rgba(245,176,66,0.55)' : 'rgba(120,175,255,0.55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(120,175,255,0.2)';
  ctx.beginPath();
  ctx.arc(m.x, m.y, m.r - 8, 0, Math.PI * 2);
  ctx.stroke();

  const halo = ctx.createRadialGradient(m.x, m.y, 8, m.x, m.y, m.r);
  halo.addColorStop(0, 'rgba(120,175,255,0.10)');
  halo.addColorStop(1, 'rgba(120,175,255,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
  ctx.fill();

  const rot = S.projAngle * 0.45;
  ctx.fillStyle = 'rgba(185,220,255,0.92)';
  for (const st of mapStars) {
    const a = st.a + rot;
    ctx.beginPath();
    ctx.arc(m.x + Math.cos(a) * st.r, m.y + Math.sin(a) * st.r, st.s, 0, Math.PI * 2);
    ctx.fill();
  }

  if (zoomDetail) {
    ctx.strokeStyle = 'rgba(140,190,255,0.28)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    let first = true;
    for (const st of mapStars) {
      const a = st.a + rot;
      const px = m.x + Math.cos(a) * st.r;
      const py = m.y + Math.sin(a) * st.r;
      if (first) {
        ctx.moveTo(px, py);
        first = false;
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();
    for (let k = 0; k < 24; k++) {
      const a = (k * Math.PI) / 12;
      ctx.beginPath();
      ctx.moveTo(m.x + Math.cos(a) * (m.r - 2), m.y + Math.sin(a) * (m.r - 2));
      ctx.lineTo(m.x + Math.cos(a) * (m.r + 4), m.y + Math.sin(a) * (m.r + 4));
      ctx.strokeStyle = 'rgba(185,220,255,0.3)';
      ctx.stroke();
    }
  }

  const ea = extraStarAngle();
  const ex = m.x + Math.cos(ea) * EXTRA_STAR_RADIUS;
  const ey = m.y + Math.sin(ea) * EXTRA_STAR_RADIUS;
  ctx.save();
  ctx.shadowColor = 'rgba(245,176,66,0.9)';
  ctx.shadowBlur = 12 + 6 * Math.sin(t / 300);
  ctx.fillStyle = '#f5b042';
  ctx.beginPath();
  ctx.arc(ex, ey, 3.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.restore();

  if (S.clues.extraStar && S.projAngle === ALIGNED_PROJ && S.drawingPlaced) {
    ctx.save();
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = 'rgba(245,176,66,0.55)';
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(drawing.x, drawing.y);
    ctx.stroke();
    ctx.restore();
  }

  ctx.fillStyle = 'rgba(232,236,243,0.6)';
  ctx.font = '12px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('全息星图', m.x, m.y + m.r + 18);

  if (hover === 'starMap' && !S.truthRevealed) {
    ctx.strokeStyle = `rgba(245,176,66,${pulse(t)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r + 6, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawDisplayCase(t) {
  const c = SCENE.displayCase;
  const cx = c.x;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(cx, 402, 96, 13, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#242b46';
  ctx.beginPath();
  ctx.moveTo(cx - 50, 330);
  ctx.lineTo(cx + 50, 330);
  ctx.lineTo(cx + 72, 402);
  ctx.lineTo(cx - 72, 402);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#303a5c';
  ctx.beginPath();
  ctx.moveTo(cx - 62, 326);
  ctx.lineTo(cx + 62, 326);
  ctx.lineTo(cx + 50, 334);
  ctx.lineTo(cx - 50, 334);
  ctx.closePath();
  ctx.fill();

  const glow = ctx.createRadialGradient(cx, 316, 4, cx, 316, 92);
  glow.addColorStop(0, 'rgba(245,176,66,0.45)');
  glow.addColorStop(1, 'rgba(245,176,66,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, 316, 92, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.shadowColor = 'rgba(245,176,66,0.9)';
  ctx.shadowBlur = 26;
  ctx.fillStyle = '#ffc95e';
  ctx.beginPath();
  ctx.arc(cx, 318, 15 + Math.sin(t / 600), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.32)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, 334, 58, Math.PI, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(210,225,255,0.05)';
  ctx.beginPath();
  ctx.arc(cx, 334, 58, Math.PI, Math.PI * 2);
  ctx.fill();

  if (S.clues.glassReflection) {
    const pts = [
      [cx - 36, 300],
      [cx - 14, 288],
      [cx + 12, 292],
      [cx + 34, 306],
      [cx - 26, 318],
    ];
    for (let i = 0; i < pts.length; i++) {
      const tw = 0.45 + 0.5 * Math.sin(t / 320 + i * 1.7);
      ctx.globalAlpha = Math.max(0.18, tw);
      ctx.fillStyle = '#fff8e6';
      ctx.beginPath();
      ctx.arc(pts[i][0], pts[i][1], 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  ctx.fillStyle = 'rgba(240,243,250,0.65)';
  ctx.font = '12px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('主展柜 · 琥珀', cx, 428);

  if (zoomDetail) {
    ctx.fillStyle = '#2a3356';
    ctx.beginPath();
    ctx.roundRect(cx - 52, 393, 104, 17, 3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(245,176,66,0.45)';
    ctx.stroke();
    ctx.fillStyle = '#ffd98a';
    ctx.font = '10px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('星尘琥珀 · 特展', cx, 405);

    ctx.fillStyle = 'rgba(120,70,20,0.55)';
    for (let i = 0; i < 5; i++) {
      const a = i * 1.3 + t / 4000;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * 6, 318 + Math.sin(a * 1.7) * 5, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (S.clues.drawingMatch && performance.now() - matchAnimAt < 6000) {
    const a = 0.5 + 0.5 * Math.sin(t / 180);
    ctx.fillStyle = `rgba(74,222,128,${0.45 + a * 0.5})`;
    ctx.font = '13px "Microsoft YaHei", sans-serif';
    ctx.fillText('星位一致 ✓', cx, 250 - a * 4);
  }
}

function drawCabinet(t) {
  const c = SCENE.cabinet;
  const x = c.x;

  ctx.fillStyle = '#27304e';
  ctx.beginPath();
  ctx.roundRect(x - c.w / 2, c.y - c.h / 2, c.w, c.h, 7);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.stroke();

  for (let i = 0; i < 2; i++) {
    const dy = c.y - c.h / 2 + 12 + i * 42;
    const open = S.cabinetOpen && i === 0;
    const oy = open ? 12 : 0;
    const ox = open ? 10 : 0;
    ctx.fillStyle = '#333d63';
    ctx.beginPath();
    ctx.roundRect(x - c.w / 2 + 10 + ox, dy + oy, c.w - 20, 34, 4);
    ctx.fill();
    ctx.fillStyle = '#b3bcd2';
    ctx.fillRect(x - 7 + ox, dy + 15 + oy, 14, 3);
    if (open) {
      const cw = zoomDetail ? 74 : 40;
      ctx.fillStyle = '#f0ead8';
      ctx.beginPath();
      ctx.roundRect(x - 12, dy + oy + 16, cw, zoomDetail ? 38 : 26, 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(80,60,20,0.4)';
      ctx.stroke();
      ctx.fillStyle = 'rgba(80,60,20,0.75)';
      ctx.font = `${zoomDetail ? 9.5 : 7}px "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText('借用登记 19:42', x - 9, dy + oy + (zoomDetail ? 28 : 25));
      ctx.fillText('主展柜钥匙 周叔', x - 9, dy + oy + (zoomDetail ? 41 : 35));
    }
  }

  ctx.fillStyle = 'rgba(240,243,250,0.6)';
  ctx.font = '12px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('钥匙柜', x, c.y + c.h / 2 + 18);

  if (hover === 'cabinet' && !S.truthRevealed) {
    ctx.strokeStyle = `rgba(245,176,66,${pulse(t)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x - c.w / 2 - 5, c.y - c.h / 2 - 5, c.w + 10, c.h + 10, 10);
    ctx.stroke();
  }
}

function drawLectern(t) {
  const l = SCENE.lectern;
  ctx.fillStyle = '#27304e';
  ctx.beginPath();
  ctx.roundRect(l.x - l.w / 2, l.y - l.h / 2, l.w, l.h, 6);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.stroke();
  ctx.fillStyle = '#333d63';
  ctx.beginPath();
  ctx.roundRect(l.x - l.w / 2 + 5, l.y - l.h / 2 + 5, l.w - 10, 16, 4);
  ctx.fill();

  if (S.scriptRead) {
    ctx.save();
    ctx.shadowColor = 'rgba(255,248,230,0.6)';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#f5efdc';
    ctx.beginPath();
    if (zoomDetail) {
      ctx.roundRect(l.x - 52, l.y - l.h / 2 - 80, 104, 66, 4);
    } else {
      ctx.roundRect(l.x - 28, l.y - l.h / 2 - 36, 56, 32, 3);
    }
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(90,70,30,0.5)';
    if (zoomDetail) {
      ctx.fillStyle = 'rgba(90,60,25,0.8)';
      ctx.font = '10px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('闭馆讲解稿 · 最后一页', l.x - 44, l.y - l.h / 2 - 62);
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(l.x - 44, l.y - l.h / 2 - 48 + i * 10);
        ctx.lineTo(l.x + (i === 4 ? 10 : 40), l.y - l.h / 2 - 48 + i * 10);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(140,70,30,0.9)';
      ctx.font = '10px "Microsoft YaHei", sans-serif';
      ctx.fillText('「留给会画星星的小朋友」', l.x - 44, l.y - l.h / 2 - 4);
    } else {
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(l.x - 20, l.y - l.h / 2 - 28 + i * 7);
        ctx.lineTo(l.x + 20, l.y - l.h / 2 - 28 + i * 7);
        ctx.stroke();
      }
    }
  }

  ctx.fillStyle = 'rgba(240,243,250,0.6)';
  ctx.font = '12px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('讲解台', l.x, l.y + l.h / 2 + 18);

  if (hover === 'lectern' && !S.truthRevealed) {
    ctx.strokeStyle = `rgba(245,176,66,${pulse(t)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(l.x - l.w / 2 - 5, l.y - l.h / 2 - 5, l.w + 10, l.h + 10, 10);
    ctx.stroke();
  }
}

function drawBench(t) {
  const b = SCENE.bench;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(b.x, b.y + 14, 70, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#2b3454';
  ctx.beginPath();
  ctx.roundRect(b.x - 62, b.y - 6, 124, 14, 5);
  ctx.fill();
  ctx.fillStyle = '#37436b';
  ctx.beginPath();
  ctx.roundRect(b.x - 62, b.y - 16, 124, 10, 5);
  ctx.fill();

  ctx.fillStyle = 'rgba(240,243,250,0.5)';
  ctx.font = '12px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('休息区', b.x, b.y + 36);
}

function drawDrawing(t) {
  const d = drawing;
  ctx.save();
  if (!S.drawingPlaced) {
    ctx.shadowColor = 'rgba(245,176,66,0.5)';
    ctx.shadowBlur = pulse(t, 400, 6, 9);
  }
  ctx.fillStyle = '#f6f0e0';
  ctx.beginPath();
  ctx.roundRect(d.x - d.w / 2, d.y - d.h / 2, d.w, d.h, 3);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = 'rgba(90,70,40,0.35)';
  ctx.stroke();

  ctx.fillStyle = '#e8a33c';
  ctx.beginPath();
  ctx.arc(d.x + 10, d.y - 4, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#6b7fa8';
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(d.x - 14 + i * 8, d.y + 7 - (i % 2) * 7, 1.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(107,127,168,0.5)';
  ctx.beginPath();
  ctx.moveTo(d.x - 14, d.y + 7);
  ctx.lineTo(d.x - 6, d.y);
  ctx.lineTo(d.x + 2, d.y + 7);
  ctx.stroke();

  if (S.drawingPlaced) {
    ctx.strokeStyle = 'rgba(170,160,130,0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(d.x - 20, d.y + d.h / 2 + 32);
    ctx.lineTo(d.x - 6, d.y + d.h / 2 + 2);
    ctx.moveTo(d.x + 20, d.y + d.h / 2 + 32);
    ctx.lineTo(d.x + 6, d.y + d.h / 2 + 2);
    ctx.stroke();
  }

  if (hover === 'drawing' && !S.drawingPlaced) {
    ctx.strokeStyle = `rgba(245,176,66,${pulse(t)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(d.x - d.w / 2 - 5, d.y - d.h / 2 - 5, d.w + 10, d.h + 10, 6);
    ctx.stroke();
  }
}

function drawNpc(t) {
  const n = SCENE.npc;
  const bob = Math.sin(t / 900) * 3;
  const sway = Math.sin(t / 1600) * 0.01;
  const talking = npcSayText && performance.now() - npcSayAt < 9000;
  const headX = n.x;
  const headY = 352 + bob;
  const hairDark = '#3c2f47';
  const hairMid = '#57456a';
  const hairLight = '#8a7196';

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(n.x, 472, 42, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.translate(n.x, 470);
  ctx.rotate(sway);
  ctx.translate(-n.x, -470);

  const backSway = Math.sin(t / 700) * 2;
  ctx.fillStyle = hairDark;
  ctx.beginPath();
  ctx.moveTo(headX - 20, headY - 26);
  ctx.bezierCurveTo(headX - 34, headY - 4, headX - 30, headY + 30, headX - 24 + backSway, headY + 52);
  ctx.lineTo(headX + 24 + backSway, headY + 52);
  ctx.bezierCurveTo(headX + 30, headY + 30, headX + 34, headY - 4, headX + 20, headY - 26);
  ctx.closePath();
  ctx.fill();

  const hemWave = Math.sin(t / 620) * 3;
  ctx.fillStyle = '#7d6ae8';
  ctx.beginPath();
  ctx.moveTo(n.x - 24, 378 + bob);
  ctx.lineTo(n.x + 24, 378 + bob);
  ctx.quadraticCurveTo(n.x + 34, 424, n.x + 36, 466 + hemWave);
  ctx.quadraticCurveTo(n.x, 472 - hemWave * 0.6, n.x - 36, 466 - hemWave);
  ctx.quadraticCurveTo(n.x - 34, 424, n.x - 24, 378 + bob);
  ctx.closePath();
  ctx.fill();

  const dressShade = ctx.createLinearGradient(n.x - 36, 380, n.x + 36, 470);
  dressShade.addColorStop(0, 'rgba(255,255,255,0.14)');
  dressShade.addColorStop(0.5, 'rgba(255,255,255,0)');
  dressShade.addColorStop(1, 'rgba(20,16,40,0.35)');
  ctx.fillStyle = dressShade;
  ctx.beginPath();
  ctx.moveTo(n.x - 24, 378 + bob);
  ctx.lineTo(n.x + 24, 378 + bob);
  ctx.quadraticCurveTo(n.x + 34, 424, n.x + 36, 466 + hemWave);
  ctx.quadraticCurveTo(n.x, 472 - hemWave * 0.6, n.x - 36, 466 - hemWave);
  ctx.quadraticCurveTo(n.x - 34, 424, n.x - 24, 378 + bob);
  ctx.closePath();
  ctx.fill();

  const armSway = Math.sin(t / 1000) * 2.5;
  ctx.strokeStyle = '#6f5bd6';
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(n.x - 22, 386 + bob);
  ctx.lineTo(n.x - 33, 424 + bob + armSway);
  ctx.moveTo(n.x + 22, 386 + bob);
  ctx.lineTo(n.x + 33, 424 + bob - armSway);
  ctx.stroke();
  ctx.fillStyle = '#e8d8c6';
  ctx.beginPath();
  ctx.arc(n.x - 33, 428 + bob + armSway, 3.5, 0, Math.PI * 2);
  ctx.arc(n.x + 33, 428 + bob - armSway, 3.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#e8d8c6';
  ctx.fillRect(headX - 7, headY - 4, 14, 16);
  ctx.beginPath();
  ctx.arc(headX, headY - 18, 17, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = hairDark;
  ctx.beginPath();
  ctx.arc(headX, headY - 22, 17.5, Math.PI * 0.95, Math.PI * 2.05);
  ctx.fill();

  ctx.fillStyle = hairMid;
  ctx.beginPath();
  ctx.arc(headX - 12, headY - 30, 5.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = hairMid;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(headX - 15, headY - 30);
  ctx.quadraticCurveTo(headX - 4, headY - 36, headX + 10, headY - 31);
  ctx.stroke();

  ctx.strokeStyle = hairLight;
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 3; i++) {
    const ph = Math.sin(t / 650 + i * 1.9) * 1.8;
    ctx.beginPath();
    ctx.moveTo(headX - 16 + i * 3, headY - 24);
    ctx.quadraticCurveTo(headX - 20 + ph, headY - 8, headX - 17 + ph, headY + 10 + i * 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(headX + 16 - i * 3, headY - 24);
    ctx.quadraticCurveTo(headX + 20 - ph, headY - 8, headX + 17 - ph, headY + 10 + i * 3);
    ctx.stroke();
  }

  const ahogeSway = Math.sin(t / 520) * 4;
  ctx.strokeStyle = hairMid;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(headX + 2, headY - 38);
  ctx.quadraticCurveTo(headX + 9 + ahogeSway, headY - 52, headX + 20 + ahogeSway, headY - 44);
  ctx.stroke();

  const glance = Math.sin(t / 2600) * 1.4;
  const blink = t % 3800 < 130;
  if (blink) {
    ctx.strokeStyle = hairDark;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(headX - 8, headY - 17);
    ctx.lineTo(headX - 3, headY - 17);
    ctx.moveTo(headX + 3, headY - 17);
    ctx.lineTo(headX + 8, headY - 17);
    ctx.stroke();
  } else {
    ctx.fillStyle = '#43364a';
    ctx.beginPath();
    ctx.arc(headX - 5.5 + glance, headY - 17, 1.8, 0, Math.PI * 2);
    ctx.arc(headX + 5.5 + glance, headY - 17, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.arc(headX - 5 + glance, headY - 17.8, 0.6, 0, Math.PI * 2);
    ctx.arc(headX + 6 + glance, headY - 17.8, 0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = '#b3555a';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(headX + glance * 0.5, headY - 11, 3.6, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,150,140,0.25)';
  ctx.beginPath();
  ctx.arc(headX - 9 + glance, headY - 12, 2.6, 0, Math.PI * 2);
  ctx.arc(headX + 9 + glance, headY - 12, 2.6, 0, Math.PI * 2);
  ctx.fill();

  if (talking) {
    ctx.strokeStyle = 'rgba(255,214,150,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(headX, headY - 18, 19.5, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  }

  ctx.restore();

  ctx.fillStyle = '#eef1f8';
  ctx.font = '13px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('林晚', n.x, 330 + bob);

  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i < S.trust ? '#f5b042' : 'rgba(232,236,243,0.22)';
    ctx.beginPath();
    ctx.arc(n.x - 12 + i * 12, 344 + bob, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }

  if (hover === 'npc' && !introActive) {
    ctx.strokeStyle = `rgba(245,176,66,${pulse(t)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(n.x, 440, 56, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawStarEffects(t) {
  const now = performance.now();
  for (let i = starFx.length - 1; i >= 0; i--) {
    const fx = starFx[i];
    const age = now - fx.at;
    if (age > 1300) {
      starFx.splice(i, 1);
      continue;
    }
    const p = age / 1300;
    const ox = cam.x * 0.5;
    const oy = cam.y * 0.4;

    ctx.save();
    ctx.globalAlpha = 1 - p;
    ctx.strokeStyle = 'rgba(255,224,160,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(fx.x + ox, fx.y + oy, 4 + p * 26, 0, Math.PI * 2);
    ctx.stroke();

    for (let k = 0; k < 8; k++) {
      const ang = (k * Math.PI) / 4 + p * 0.6;
      const r1 = 6 + p * 18;
      const r2 = 10 + p * 30;
      ctx.beginPath();
      ctx.moveTo(fx.x + ox + Math.cos(ang) * r1, fx.y + oy + Math.sin(ang) * r1);
      ctx.lineTo(fx.x + ox + Math.cos(ang) * r2, fx.y + oy + Math.sin(ang) * r2);
      ctx.stroke();
    }

    const g = ctx.createRadialGradient(fx.x + ox, fx.y + oy, 0, fx.x + ox, fx.y + oy, 20);
    g.addColorStop(0, `rgba(255,236,190,${0.6 * (1 - p)})`);
    g.addColorStop(1, 'rgba(255,236,190,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(fx.x + ox, fx.y + oy, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function wrapCn(text, perLine) {
  const lines = [];
  let cur = '';
  for (const ch of String(text)) {
    cur += ch;
    if (cur.length >= perLine || ch === '\n') {
      lines.push(cur.replace(/\n/g, ''));
      cur = '';
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 5);
}

function drawBubble(t) {
  if (!npcSayText || performance.now() - npcSayAt > 9000) return;
  const age = performance.now() - npcSayAt;
  const fade = age > 8200 ? 1 - (age - 8200) / 800 : 1;

  const lines = wrapCn(npcSayText, 16);
  const lineH = 19;
  const bw = Math.max(...lines.map((l) => l.length)) * 13.5 + 28;
  const bh = lines.length * lineH + 22;
  const anchor = worldToScreen(SCENE.npc.x, 340);
  const bx = clamp(anchor.x - bw / 2, 12, 960 - bw - 12);
  const by = Math.max(12, anchor.y - bh);
  const tailX = clamp(anchor.x, bx + 16, bx + bw - 16);

  ctx.save();
  ctx.globalAlpha = Math.max(0, fade);
  ctx.fillStyle = 'rgba(255,251,242,0.96)';
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 10);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(tailX - 8, by + bh);
  ctx.lineTo(tailX + 2, by + bh + 10);
  ctx.lineTo(tailX + 8, by + bh);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#2c2418';
  ctx.font = '13px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'left';
  lines.forEach((ln, i) => {
    ctx.fillText(ln, bx + 14, by + 24 + i * lineH);
  });
  ctx.restore();
}

const OBJ_ANCHORS = {
  spotlight: { x: 340, y: 78, r: 34 },
  starMap: { x: 480, y: 196, r: 58 },
  drawing: { x: 790, y: 456, r: 40 },
  cabinet: { x: 140, y: 352, r: 58 },
  lectern: { x: 810, y: 338, r: 54 },
  npc: { x: 620, y: 430, r: 62 },
};

function drawObjectivePulse(t) {
  if (introActive || storyPlaying || view.focus) return;
  const obj = nextObjective();
  if (!obj) return;
  const anchor = OBJ_ANCHORS[obj.key];
  if (!anchor) return;

  const a = pulse(t, 500, 0.22, 0.3);
  const p = worldToScreen(anchor.x, anchor.y);
  const r = anchor.r * view.zoom;
  ctx.save();
  ctx.strokeStyle = `rgba(245,176,66,${a})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r + 8 + Math.sin(t / 500) * 3, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = `rgba(255,217,138,${a + 0.25})`;
  ctx.font = '12px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(obj.text, clamp(p.x, 110, 850), p.y - r - 14);
  ctx.restore();
}

function drawFocusControls(t) {
  if (!view.focus || view.zoom < 1.6) return;
  if (view.focus === 'spotlight') {
    const bar = { x: 340, y: 182, w: 240, h: 36 };
    const labels = ['左15°', '正中', '右15°'];
    ctx.save();
    ctx.fillStyle = 'rgba(10,14,26,0.82)';
    ctx.beginPath();
    ctx.roundRect(bar.x - bar.w / 2, bar.y - bar.h / 2, bar.w, bar.h, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(245,176,66,0.35)';
    ctx.stroke();
    const segW = bar.w / 3;
    for (let i = 0; i < 3; i++) {
      const sx = bar.x - bar.w / 2 + i * segW;
      if (i === S.lightAngle) {
        ctx.fillStyle = 'rgba(245,176,66,0.22)';
        ctx.beginPath();
        ctx.roundRect(sx + 3, bar.y - bar.h / 2 + 3, segW - 6, bar.h - 6, 6);
        ctx.fill();
        ctx.strokeStyle = 'rgba(245,176,66,0.6)';
        ctx.stroke();
      }
      ctx.fillStyle = i === S.lightAngle ? '#ffd98a' : 'rgba(220,228,244,0.65)';
      ctx.font = '13px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(labels[i], sx + segW / 2, bar.y + 5);
    }
    ctx.restore();
  } else if (view.focus === 'starMap') {
    ctx.save();
    for (const [dx, sym] of [
      [-88, '‹'],
      [88, '›'],
    ]) {
      const ax = 480 + dx;
      ctx.fillStyle = 'rgba(10,14,26,0.75)';
      ctx.beginPath();
      ctx.arc(ax, 212, 17, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,175,255,0.55)';
      ctx.stroke();
      ctx.fillStyle = '#bfe0ff';
      ctx.font = '20px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText(sym, ax, 219);
    }
    ctx.fillStyle = 'rgba(185,220,255,0.85)';
    ctx.font = '13px "Microsoft YaHei", sans-serif';
    ctx.fillText(
      S.projAngle === ALIGNED_PROJ ? '档位:已对齐' : `档位 ${S.projAngle + 1} / 3`,
      480,
      262
    );
    ctx.restore();
  }
}

function drawFocusOverlay(t) {
  if (!view.focus) return;
  const label = FOCUS_LABELS[view.focus] || '';
  const hint = FOCUS_HINTS[view.focus] || '';
  ctx.save();
  ctx.fillStyle = 'rgba(10,14,24,0.62)';
  ctx.beginPath();
  ctx.roundRect(480 - 150, 22, 300, 36, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(245,176,66,0.32)';
  ctx.stroke();
  ctx.fillStyle = '#ffd98a';
  ctx.font = '14px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`正在查看:${label}`, 480, 45);

  ctx.fillStyle = 'rgba(232,236,243,0.85)';
  ctx.font = '13px "Microsoft YaHei", sans-serif';
  ctx.fillText(hint, 480, 606);
  ctx.restore();
}

function drawVignette() {
  const v = ctx.createRadialGradient(480, 320, 260, 480, 320, 620);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, 960, 640);
}

function drawMemorialStar(t) {
  const x = 480;
  const y = 84;
  const a = 0.8 + 0.2 * Math.sin(t / 500);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.shadowColor = 'rgba(245,176,66,0.9)';
  ctx.shadowBlur = 32;
  ctx.fillStyle = '#ffc95e';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 20 : 8;
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const px = x + Math.cos(ang) * r;
    const py = y + Math.sin(ang) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = 'rgba(255,217,138,0.95)';
  ctx.font = '13px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('小满的星', x, y + 38);
}

function frame(now) {
  render(now);
  requestAnimationFrame(frame);
}

updateAll();
updateProfileChip('加载中');
loadProfile();
if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('intro') === '0') {
  introActive = false;
  introEl.classList.add('hidden');
  npcSay('先从头顶的聚光灯开始吧——把它调到正中,看看玻璃上会有什么。');
} else {
  playSequence(INTRO_LINES, '林晚', onIntroFinished);
}
if (typeof location !== 'undefined') {
  const fp = new URLSearchParams(location.search).get('focus');
  if (fp && FOCUS[fp]) {
    focusObject(fp);
    view.x = view.tx;
    view.y = view.ty;
    view.zoom = view.tzoom;
  }
}
input.focus();
requestAnimationFrame(frame);
