/*
 * 星尘琥珀 · 后台 Agent 状态机内核
 * ------------------------------------------------------------
 * 职责:这是一个“世界导演”Agent。它不渲染画面、不做物理,
 * 而是根据玩家【实时点击 / 对话】+ 当前游戏快照,做出一致性判定,
 * 输出:台词、旁白、支线任务的解锁/完成、方向引导、结局裁决。
 *
 * 设计原则(与前端解耦):
 *   - 前端负责“确定性模拟”(线索、灯光、拼豆等视觉与开关)。
 *   - Agent 负责“叙事与支线”(回应、支线进度、引导、结局)。
 *   - 双方通过快照(snapshot)+指令(directives)通信,可离线回退。
 *
 * 纯函数式会话对象,便于测试与后续接入 LLM(把 decide() 换成模型调用即可)。
 */

export const SIDE_META = {
  scribble: { title: '誊写稿', desc: '读一读讲解台上的最后一页' },
  starmap: { title: '星图往事', desc: '再点一次全息星图,听她讲星图的来历' },
  kindness: { title: '一句关心', desc: '在对话里问一句:你还好吗?' }
};

export function createSession() {
  return {
    id: '',
    holoTalks: 0,
    npcTalks: 0,
    side: { scribble: 'locked', starmap: 'locked', kindness: 'locked' },
    turns: 0
  };
}

const EVIDENCE_ORDER = ['glass', 'key', 'pin', 'star'];
const CLUE_KEY = { star: 'extraStar', glass: 'glassReflection', key: 'keyLog', pin: 'pinArt' };
const EXCUSE = {
  star: '那是星表录入时的误差。系统最近总出错,您别为难我。',
  glass: '灯光角度是馆里定好的,反光……大概只是玻璃没擦干净。',
  key: '钥匙?周叔在筹备特展,钥匙本来就是他在管。',
  pin: '那幅画是小满的,她自己画的。跟我没关系。'
};
const EXAMPLE = {
  star: '「穹顶上那颗多出来的星,是怎么回事?」',
  glass: '「地上的反光星点,是谁弄出来的?」',
  key: '「主展柜的钥匙是谁借走的?」',
  pin: '「这幅拼豆画是谁的?」'
};

function clueFound(snapshot, kind) {
  const c = snapshot.clues || {};
  return !!c[CLUE_KEY[kind]];
}

function nextUnpresented(snapshot) {
  const presented = new Set(snapshot.presented || []);
  for (const k of EVIDENCE_ORDER) {
    if (clueFound(snapshot, k) && !presented.has(k)) return k;
  }
  return null;
}

function detectChatIntent(snapshot, text) {
  const msg = text || '';
  if ((snapshot.stage | 0) >= 3) {
    if (/特展|隐瞒|瞒|申请|留下|帮她|不上报|别上报|别声张|展览|争取|给她|通融|原谅|从轻/.test(msg)) return { action: 'gallery' };
    if (/上报|举报|违规|报告|通报|处理|照章|公事|按规矩|没收|扣下|处分/.test(msg)) return { action: 'report' };
  }
  if (/还好吗|你还好|辛苦|休息|别太累|谢谢|对不起|抱歉|心疼|不容易|照顾好/.test(msg)) return { action: 'kindness' };
  let kind = null;
  if (/反光|玻璃|地面|星点|光斑|倒影|亮起/.test(msg)) kind = 'glass';
  else if (/钥匙|周叔|借|登记|柜子|抽屉/.test(msg)) kind = 'key';
  else if (/拼豆|豆子|豆|画|小满|星宿|北斗/.test(msg)) kind = 'pin';
  else if (/星图|暖星|多星|多出来|多出|0317|穹顶|那颗星|多一颗|星星|星/.test(msg)) kind = 'star';
  if (kind) return { action: 'evidence', kind };
  if ((snapshot.stage | 0) < 3 && /招|承认|说实话|别装|交代|说清楚|解释|答案|为什么|是不是|瞒|藏|骗|有问题|不对劲|心虚|看穿|说谎|撒谎|坦白|给个说法|到底|闭嘴|别绕/.test(msg)) {
    const next = nextUnpresented(snapshot);
    if (next) return { action: 'evidence', kind: next };
  }
  return { action: 'idle' };
}

/* 单次决策:返回给前端的指令集 */
export function act(session, snapshot, event) {
  session.turns++;
  const directives = [];
  const push = (op) => directives.push(op);
  const log = (kind, who, text) => push({ op: 'log', kind, who, text });
  const say = (who, text) => push({ op: 'say', who, text });
  const completeSide = (id) => {
    if (session.side[id] === 'done') return false;
    session.side[id] = 'done';
    push({ op: 'side', id, status: 'done' });
    log('hint', '支线完成 · ' + SIDE_META[id].title, SIDE_META[id].desc);
    return true;
  };

  const type = event && event.type;
  const stage = snapshot.stage | 0;
  const pressure = snapshot.pressure | 0;

  if (stage >= 4) {
    say('林晚', '……都结束了。您慢走。');
    return { directives };
  }

  if (type === 'click') {
    const target = event.target;
    if (target === 'lectern') {
      if (!snapshot.lecternRead) {
        log('story', '旁白', '讲解台的最后一页被翻旧了,字迹却工整——那是她替小满重写的一版讲解稿。');
        if (completeSide('scribble')) say('林晚', '……那是我自己写的,不关馆里的事。');
        else say('林晚', '那页纸……您别往外念,行吗?');
      } else {
        say('林晚', '那页稿子,我背给您听也行。');
      }
    } else if (target === 'holo') {
      session.holoTalks++;
      if (session.holoTalks >= 2) {
        if (completeSide('starmap')) {
          log('story', '旁白', '她难得地松了口,讲起这张星图的来历——一个孩子说,想看看爸爸的星座。');
          say('林晚', '星图是系统投的。但编号 0317 那颗星……是有人手动加进去的。');
        } else {
          say('林晚', '星图会一直转,像什么都没发生过一样。');
        }
      } else {
        say('林晚', '全息星图只是投影,您别盯着看太久,晃眼。');
      }
    } else if (target === 'npc') {
      session.npcTalks++;
      if (pressure >= 3) say('林晚', '……您想问的,其实我都知道。');
      else if (pressure > 0) say('林晚', '您再问,我也只能这么说。');
      else say('林晚', '闭馆了,您还不走吗?');
    } else if (target === 'spotlight') {
      if (!snapshot.lightOn) say('旁白', '啪的一声,聚光灯亮了。');
      else if (snapshot.lightAngle === 1) say('旁白', '光束正正打在展柜上,地上浮起一圈星点。');
      else say('旁白', '光束偏了。地上什么也没有。');
    } else if (target === 'dome') {
      say('旁白', snapshot.clues && snapshot.clues.extraStar ? '编号 0317 的空缺里,那颗暖星还在。' : '星表在缓缓旋转,暂时看不出异常。');
    } else if (target === 'cabinet') {
      say('旁白', snapshot.cabinetOpen ? '借用登记上写着:主展柜钥匙,借出人——周叔。' : '钥匙柜又合上了。');
    } else if (target === 'perler') {
      if (snapshot.clues && snapshot.clues.pinArt) say('林晚', '画上的星位,和地上的反光对上了。');
      else say('林晚', '那孩子的画,还没拼完呢。');
    }
    return { directives };
  }

  if (type === 'chat') {
    const intent = detectChatIntent(snapshot, event.text);
    if (intent.action === 'kindness') {
      const done = completeSide('kindness');
      if (done) {
        log('story', '旁白', '她愣了一下,像很久没人这样问过她。');
        say('林晚', '……我没事。只是有点累。谢谢您。');
        push({ op: 'trust', delta: 1 });
      } else {
        say('林晚', '我真的没事,您还是先办正事吧。');
      }
      return { directives };
    }
    if (intent.action === 'gallery' || intent.action === 'report') {
      if (stage >= 3) {
        say('林晚', intent.action === 'gallery' ? '……您真的愿意,替她争取一个特展?' : '……按规矩办吧。我认。');
        push({ op: 'ending', which: intent.action });
      } else {
        say('林晚', '现在是您做决定的时候吗?先把事情弄清楚。');
      }
      return { directives };
    }
    if (intent.action === 'evidence') {
      const kind = intent.kind;
      if (!clueFound(snapshot, kind)) {
        say('林晚', kind === 'star' ? '星表是系统投的,我改不了。' : kind === 'glass' ? '灯光是馆里调的,反光我没注意。' : kind === 'key' ? '钥匙的事,您问周叔去。' : '那画跟今晚没关系。');
        return { directives };
      }
      say('林晚', EXCUSE[kind]);
      push({ op: 'present', kind });
      return { directives };
    }
    const next = nextUnpresented(snapshot);
    if (stage < 3 && next) log('hint', '提示', '把证物直接摆到她面前试试,比如 ' + EXAMPLE[next]);
    say('林晚', pressure >= 3 ? '……我没什么好说的了。' : pressure > 0 ? '您总能问到我答不上来的地方。' : '闭馆了,如果只是随便看看,就请回吧。');
    return { directives };
  }

  return { directives };
}

/* 供测试/自检使用:返回带初始支线状态的快照 */
export function snapshotOf(session, extra) {
  return Object.assign({ stage: 0, pressure: 0, trust: 0, presented: [], clues: {}, lightOn: false, lightAngle: 1, lecternRead: false, cabinetOpen: false }, extra || {});
}
