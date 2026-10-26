// Мозг расширения: чистые функции без chrome.* — их гоняют тесты в Node.
// Что считать «окном для реплая», как считать жар, журнал своих реплаев.

export const DEFAULTS = {
  me: "", // твой хэндл без @ — чтобы собирать журнал реплаев
  // Дефолты подобраны на реальных данных: маленькому аккаунту выгоднее аккаунты 5k–200k,
  // окно ~15 мин и посты, где ещё нет толпы.
  minFollowers: 5000, // меньше — не алертим (кроме watchlist)
  hotFollowers: 200000, // больше — мега-аккаунт: алертим только горячие посты
  maxAgeMin: 15, // пост старше — реплай уже утонет
  maxReplies: 30, // под постом уже столько ответов — ты не в первом экране; 0 = без лимита
  minHeat: 1.5,
  gemSpot: 2000, // 💎: столько просмотров поста приходится на одно место в ответах
  dailyGoal: 15, // реплаев в день: цель и серия дней подряд
  notify: true,
  inFeedBadges: true, // метки «📡 💎 · 9m left» прямо в ленте X
  tgEnabled: false, // алерты в Telegram-бота — чтобы не пропустить гем с телефона
  tgToken: "",
  tgChatId: "",
  tgMode: "gems", // "gems" — только 💎, "all" — все окна
  watchlist: [], // всегда следить, сколько бы подписчиков ни было
  muted: [],
  topics: [], // если заданы — только посты, где есть хоть одно слово (кроме watchlist)
  muteWords: ["gm", "gn", "ticker", "airdrop", "giveaway", "ape", "follow back", "drop your", "100x", "1000x", "f4f", "#connect", "let's connect", "lets connect", "say hi", "+rt", "drop sol", "drop your wallet", "wallet address"],
  englishOnly: true,
  autoRefresh: false,
  radarUrl: "", // вкладка, которую можно перезагружать (например, твой X-список)
  refreshMin: 3,
};

const MIN = 60_000;
const HISTORY_SIZE = 20;
const MIN_SAMPLES = 3;

// Вовлечение в минуту. Реплаи и репосты весят больше лайков — как в алгоритме X.
export function score(m, ageMin) {
  const e = m.like_count + 3 * m.reply_count + 2 * m.retweet_count + 2 * m.quote_count;
  return e / Math.max(ageMin, 1);
}

export function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function emptyState() {
  return { posts: {}, history: {}, replies: {}, followers: [], days: {} };
}

const lc = (s) => String(s || "").replace(/^@/, "").trim().toLowerCase();

// Онбординг пройден? У тех, кто настроил радар до появления онбординга, есть хэндл — их не трогаем.
export function isOnboarded(raw = {}) {
  return raw.onboarded ?? Boolean(raw.me);
}

export function normalizeSettings(raw = {}) {
  const s = { ...DEFAULTS, ...raw };
  s.me = lc(s.me);
  s.watchlist = (s.watchlist || []).map(lc).filter(Boolean);
  s.muted = (s.muted || []).map(lc).filter(Boolean);
  s.topics = (s.topics || []).map((w) => String(w).trim().toLowerCase()).filter(Boolean);
  s.muteWords = (s.muteWords || []).map((w) => String(w).trim().toLowerCase()).filter(Boolean);
  return s;
}

export const TOPIC_PRESETS = {
  "AI & builders": ["ai", "agent", "agents", "llm", "gpt", "claude", "openai", "anthropic", "model", "prompt", "vibe coding", "vibecoding", "cursor", "build", "building", "built", "ship", "shipped", "launch", "launched", "saas", "startup", "mrr", "indie", "founder", "code", "coding", "dev", "developer", "app", "product", "open source"],
  Crypto: ["solana", "sol", "eth", "ethereum", "bitcoin", "btc", "base", "onchain", "defi", "wallet", "token", "crypto", "web3", "ton"],
};

const escapeRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Слово целиком: «ai» не должно срабатывать на «said». Фразы и $тикеры — просто подстрокой.
export function findWord(text, words) {
  const t = String(text || "").toLowerCase();
  for (const w of words) {
    if (/^[a-z0-9]+$/.test(w) ? new RegExp(`(^|[^a-z0-9])${escapeRe(w)}($|[^a-z0-9])`).test(t) : t.includes(w)) return w;
  }
  return null;
}

// Грубая проверка «пост на английском»: среди букв (без ссылок и @) латиница должна преобладать.
export function looksEnglish(text) {
  const clean = String(text || "").replace(/https?:\/\/\S+|@\w+/g, "");
  const letters = clean.match(/\p{L}/gu) || [];
  if (letters.length < 8) return true;
  const latin = letters.filter((c) => /[a-z]/i.test(c)).length;
  return latin / letters.length >= 0.7;
}

// «Цена места»: сколько просмотров поста приходится на одно место в ответах.
// 66k просмотров и 29 реплаев → ~2.2k: твой реплай увидит почти каждый, кто листает ответы.
export function spotOf(m) {
  if (!m || !m.views) return null;
  return Math.round(m.views / ((m.reply_count || 0) + 1));
}

export function crowdOf(replies) {
  if (replies < 10) return "early";
  if (replies < 30) return "ok";
  return "crowded";
}

// Жар: во сколько раз пост горячее обычного поста автора. null — истории ещё мало.
export function heatOf(post) {
  if (post.baseline === null || post.baseline === undefined) return null;
  if (post.baseline === 0) return post.score > 0 ? Infinity : 1;
  return post.score / post.baseline;
}

function tierOf(post, s) {
  if (s.watchlist.includes(lc(post.author))) return "always";
  return post.followers >= s.hotFollowers ? "hot" : "always";
}

// Принимает посты из очередного ответа X, обновляет состояние (мутирует) и возвращает,
// о каких постах надо уведомить прямо сейчас.
// diag (необязательно) — для «почему пусто»: возраст самого свежего поста и чем отсечён каждый свежий.
export function ingest(state, posts, rawSettings, now, diag = null) {
  const s = normalizeSettings(rawSettings);
  const alerts = [];
  if (!state.days) {
    // состояние из старой версии: один раз пересчитываем дни по журналу
    state.days = {};
    for (const r of Object.values(state.replies)) {
      if (lc(r.inReplyTo) === s.me) continue;
      const k = dayKey(r.createdAt);
      state.days[k] = (state.days[k] || 0) + 1;
    }
  }

  for (const p of posts) {
    const author = lc(p.author);

    if (s.me && author === s.me) {
      recordFollowers(state, p.followers, now);
      if (p.isReply) recordReply(state, p, s);
      continue;
    }
    if (p.isReply || p.isRetweet || p.restricted) continue;
    const ageMin = (now - p.createdAt) / MIN;
    const isFresh = ageMin <= s.maxAgeMin;
    if (diag) diag.newestAge = Math.min(diag.newestAge ?? Infinity, ageMin);
    const why = (reason) => {
      if (diag && isFresh) (diag.fresh ||= {})[p.id] = reason;
    };

    const watched = s.watchlist.includes(author);
    if (s.muted.includes(author)) { why("muted"); continue; }
    if (!watched && p.followers < s.minFollowers) { why("followers"); continue; }
    if (s.englishOnly && !watched && !looksEnglish(p.text)) { why("language"); continue; }
    if (findWord(p.text, s.muteWords)) { why("muteWords"); continue; }
    const topic = s.topics.length ? findWord(p.text, s.topics) : null;
    if (s.topics.length && !watched && !topic) { why("topic"); continue; }

    const sc = score(p.metrics, ageMin);
    let saved = state.posts[p.id];

    if (!saved) {
      const hist = state.history[author] || [];
      saved = { alerted: false, firstSeen: now, baseline: hist.length >= MIN_SAMPLES ? median(hist) : null };
      if (ageMin <= 60) state.history[author] = [...hist, sc].slice(-HISTORY_SIZE);
    }
    if (!saved.replied && Object.values(state.replies).some((r) => r.inReplyToId === p.id)) saved.replied = true;
    Object.assign(saved, {
      id: p.id, text: p.text, author: p.author, authorName: p.authorName, avatar: p.avatar || null, topic, followers: p.followers,
      verified: p.verified, createdAt: p.createdAt, metrics: p.metrics, score: sc, seenAt: now,
    });
    state.posts[p.id] = saved;

    const h = heatOf(saved);
    const fresh = ageMin <= s.maxAgeMin;
    const uncrowded = !s.maxReplies || p.metrics.reply_count <= s.maxReplies;
    const wanted = tierOf(saved, s) === "always" || h === null || h >= s.minHeat;
    if (fresh && uncrowded && wanted && !saved.alerted && !saved.replied) {
      saved.alerted = true;
      alerts.push(saved);
    }
    why(saved.alerted ? "shown" : saved.replied ? "replied" : !uncrowded ? "crowded" : "calm");
  }

  prune(state, now);
  return alerts;
}

// Свой реплай: в журнал, в счётчик дня, и пометить пост, под которым ответил.
// Реплай ловится прямо из ответа X на отправку (CreateTweet) — профиль открывать не нужно.
function recordReply(state, p, s) {
  const isNew = !state.replies[p.id];
  state.replies[p.id] = { id: p.id, text: p.text, inReplyTo: p.inReplyTo, inReplyToId: p.inReplyToId || null, createdAt: p.createdAt, metrics: p.metrics };
  if (isNew && lc(p.inReplyTo) !== s.me) {
    const k = dayKey(p.createdAt);
    state.days[k] = (state.days[k] || 0) + 1;
  }
  const target = p.inReplyToId && state.posts[p.inReplyToId];
  if (target) target.replied = true;
}

// Дата по местному времени — «сегодня» для цели дня это твой календарный день, а не UTC.
export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function goalStats(state, rawSettings, now) {
  const s = normalizeSettings(rawSettings);
  const days = state.days || {};
  const goal = Math.max(1, s.dailyGoal);
  const today = days[dayKey(now)] || 0;
  // Серия: дни подряд с выполненной целью. Сегодня ещё не добито — серия жива со вчера.
  let streak = 0;
  const d = new Date(now);
  if (today < goal) d.setDate(d.getDate() - 1);
  while ((days[dayKey(d.getTime())] || 0) >= goal) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return { today, goal, streak, done: today >= goal };
}

// В какие часы (по местному времени) твои реплаи в среднем собирают больше просмотров.
export function bestHours(state, me = "") {
  const hours = Array.from({ length: 24 }, (_, h) => ({ h, count: 0, views: 0, avg: 0 }));
  for (const r of Object.values(state.replies)) {
    if (lc(r.inReplyTo) === lc(me) || r.metrics.views == null) continue;
    const b = hours[new Date(r.createdAt).getHours()];
    b.count++;
    b.views += r.metrics.views;
  }
  for (const b of hours) b.avg = b.count ? Math.round(b.views / b.count) : 0;
  const best = [...hours].filter((b) => b.count).sort((a, b) => b.avg - a.avg)[0] || null;
  return { hours, best };
}

function recordFollowers(state, n, now) {
  if (typeof n !== "number") return;
  const last = state.followers.at(-1);
  if (last && last.n === n && now - last.t < 30 * MIN) return;
  state.followers.push({ t: now, n });
  state.followers = state.followers.slice(-500);
}

function prune(state, now) {
  for (const [id, p] of Object.entries(state.posts)) if (now - p.createdAt > 6 * 60 * MIN) delete state.posts[id];
  for (const [id, r] of Object.entries(state.replies)) if (now - r.createdAt > 14 * 24 * 60 * MIN) delete state.replies[id];
  const dayKeys = Object.keys(state.days || {}).sort();
  for (const k of dayKeys.slice(0, Math.max(0, dayKeys.length - 400))) delete state.days[k];
  const authors = Object.keys(state.history);
  for (const a of authors.slice(0, Math.max(0, authors.length - 1000))) delete state.history[a];
}

// Что показать во вкладке «Now»: свежие окна для реплая, самые свежие сверху.
export function opportunities(state, rawSettings, now) {
  const s = normalizeSettings(rawSettings);
  return Object.values(state.posts)
    .filter((p) => p.alerted && now - p.createdAt <= s.maxAgeMin * 3 * MIN)
    .map((p) => {
      const ageMin = (now - p.createdAt) / MIN;
      const spot = spotOf(p.metrics);
      return {
        ...p, ageMin, heat: heatOf(p), live: ageMin <= s.maxAgeMin, windowLeft: Math.max(0, 1 - ageMin / s.maxAgeMin),
        crowd: crowdOf(p.metrics.reply_count), spot, gem: spot !== null && spot >= s.gemSpot,
      };
    })
    // открытые окна сверху, среди них — где твой реплай увидит больше людей
    .sort((a, b) => (b.live && !b.replied) - (a.live && !a.replied) || (b.spot ?? -1) - (a.spot ?? -1) || b.createdAt - a.createdAt);
}

export function liveCount(state, rawSettings, now) {
  return opportunities(state, rawSettings, now).filter((o) => o.live && !o.replied).length;
}

// Журнал реплаев: какие ответы собрали просмотры и как растут подписчики.
export function replyStats(state, now, me = "") {
  const day = now - 24 * 60 * MIN;
  const all = Object.values(state.replies).sort((a, b) => (b.metrics.views ?? 0) - (a.metrics.views ?? 0));
  const today = all.filter((r) => r.createdAt >= day);
  const f = state.followers;
  const old = f.find((x) => x.t >= day);
  const followers = f.at(-1)?.n ?? null;
  // Под кем реплаи в среднем собирают больше всего просмотров — туда и стоит целиться.
  const by = {};
  for (const r of all) {
    const a = r.inReplyTo;
    if (!a || lc(a) === lc(me)) continue;
    (by[a] ||= { author: a, count: 0, views: 0 }).count++;
    by[a].views += r.metrics.views ?? 0;
  }
  const bestAccounts = Object.values(by)
    .map((x) => ({ ...x, avg: Math.round(x.views / x.count) }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 5);
  return {
    bestAccounts,
    top: all.slice(0, 20),
    todayCount: today.length,
    todayViews: today.reduce((sum, r) => sum + (r.metrics.views ?? 0), 0),
    followers,
    followersDelta: old && followers !== null ? followers - old.n : null,
  };
}

// Сводка «почему пусто» за последний час: из накопленных фоном пачек диагностики.
export function emptyReason(diag, rawSettings) {
  const s = normalizeSettings(rawSettings);
  const counts = {};
  for (const r of Object.values(diag?.fresh || {})) counts[r] = (counts[r] || 0) + 1;
  const fresh = Object.values(counts).reduce((a, b) => a + b, 0);
  const tips = [];
  if (!s.autoRefresh && s.radarUrl) tips.push("autoRefresh");
  if (!diag || !diag.scanned) tips.push("noScan");
  else if (!fresh) tips.push("nothingFresh");
  else {
    const top = Object.entries(counts).filter(([k]) => k !== "shown").sort((a, b) => b[1] - a[1])[0];
    if (top) tips.push("filter:" + top[0]);
  }
  return { scanned: diag?.scanned || 0, newestAge: diag?.newestAge ?? null, fresh, counts, tips };
}

// "v0.10.0" > "0.9.3": сравниваем версии по числам, а не строкой.
export function isNewer(latest, current) {
  const a = String(latest || "").replace(/^v/, "").split(".").map(Number);
  const b = String(current || "").replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (Number.isNaN(x) || Number.isNaN(y)) return false;
    if (x !== y) return x > y;
  }
  return false;
}

export function heatLabel(h) {
  if (h === null) return { icon: "🆕", text: "new author" };
  if (h === Infinity) return { icon: "🔥🔥🔥", text: "x∞ vs usual" };
  return { icon: h >= 3 ? "🔥🔥🔥" : h >= 1.5 ? "🔥" : "•", text: `x${h.toFixed(1)} vs usual` };
}

export function ago(min) {
  if (min < 1) return "just now";
  if (min < 60) return `${Math.round(min)}m`;
  return `${Math.floor(min / 60)}h`;
}
