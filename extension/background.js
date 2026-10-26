// Фон расширения: принимает посты от вкладок x.com, хранит состояние, шлёт уведомления,
// держит счётчик на иконке и (если включено) перезагружает вкладку-радар.

import { DEFAULTS, emptyState, heatLabel, heatOf, ingest, liveCount, ago, spotOf, goalStats, isNewer } from "./lib/logic.js";
import { buildMessage, sendMessage, wantsTelegram } from "./lib/telegram.js";

async function load() {
  const { state, settings } = await chrome.storage.local.get(["state", "settings"]);
  return { state: state || emptyState(), settings: { ...DEFAULTS, ...settings } };
}

// Сообщения приходят пачками; обрабатываем строго по очереди, чтобы не затереть состояние.
let queue = Promise.resolve();
const serial = (fn) => (queue = queue.then(fn).catch((e) => console.error("[reply-radar]", e)));

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "posts") serial(() => handlePosts(msg.posts, msg.op));
});

async function handlePosts(posts, op = "") {
  const { state, settings } = await load();
  const now = Date.now();
  const before = goalStats(state, settings, now);
  const d = {};
  const alerts = ingest(state, posts, settings, now, d, op);
  const after = goalStats(state, settings, now);
  const { meta = { seen: 0 } } = await chrome.storage.local.get("meta");
  // диагностика «почему пусто»: пачки за последний час
  const diag = [...(meta.diag || []).filter((b) => now - b.t < 60 * 60000), { t: now, scanned: posts.length, newestAge: d.newestAge ?? null, fresh: d.fresh || {} }];
  await chrome.storage.local.set({ state, meta: { seen: meta.seen + posts.length, lastAt: now, diag } });
  const { snoozeUntil = 0 } = await chrome.storage.local.get("snoozeUntil");
  if (settings.notify && now >= snoozeUntil) for (const p of alerts) notify(p, now, settings);
  // Пауза 🔕 глушит только уведомления на компе: Telegram как раз для того, когда ты не за ним.
  for (const p of alerts) if (wantsTelegram(p, settings)) await toTelegram(settings, buildMessage(p, settings, now));
  if (!before.done && after.done) {
    chrome.notifications.create("rr-goal", {
      type: "basic",
      iconUrl: "icons/128.png",
      title: `🎯 ${after.today}/${after.goal} — daily goal done`,
      message: after.streak > 1 ? `🔥 ${after.streak}-day streak. Go rest, you earned it.` : "First day of the streak. Same again tomorrow.",
    });
  }
  await updateBadge(state, settings);
}

async function toTelegram(settings, msg) {
  try {
    await sendMessage(settings.tgToken, settings.tgChatId, msg);
    await chrome.storage.local.set({ tgError: null });
  } catch (e) {
    await chrome.storage.local.set({ tgError: { at: Date.now(), message: String(e.message || e) } });
  }
}

function notify(p, now, settings) {
  const { icon, text } = heatLabel(heatOf(p));
  const spot = spotOf(p.metrics);
  const gem = spot !== null && spot >= settings.gemSpot;
  chrome.notifications.create(`rr|${p.author}|${p.id}`, {
    type: "basic",
    iconUrl: "icons/128.png",
    title: `${gem ? "💎 " : ""}${icon} @${p.author} · ${ago((now - p.createdAt) / 60000)} · ${text}`,
    message: p.text.slice(0, 200),
    contextMessage: `💬 ${p.metrics.reply_count} replies${spot !== null ? ` · ~${spot} views per reply spot` : ""}`,
    priority: 2,
  });
}

chrome.notifications.onClicked.addListener((id) => {
  if (id === "rr-goal") return chrome.notifications.clear(id);
  if (!id.startsWith("rr|")) return;
  const [, author, postId] = id.split("|");
  chrome.tabs.create({ url: `https://x.com/${author}/status/${postId}` });
  chrome.notifications.clear(id);
});

async function updateBadge(state, settings) {
  const n = liveCount(state, settings, Date.now());
  await chrome.action.setBadgeText({ text: n ? String(n) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#1d9bf0" });
}

// Раз в минуту: обновить счётчик (окна для реплая «протухают») и, если включено, перезагрузить радар.
chrome.alarms.create("tick", { periodInMinutes: 1 });

// Сразу после установки открываем X: радар начинает видеть посты, а попап встретит онбордингом.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") chrome.tabs.create({ url: "https://x.com/home" });
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "tick") serial(tick);
});

// Расширение ставится вручную (Load unpacked), само оно не обновится — раз в 6 часов
// спрашиваем у GitHub, нет ли новой версии, и показываем плашку в попапе.
const RELEASES = "https://api.github.com/repos/YarikDaddy/reply-radar/releases/latest";

async function checkUpdate() {
  const { update = {} } = await chrome.storage.local.get("update");
  if (Date.now() - (update.checkedAt || 0) < 6 * 60 * 60000) return;
  try {
    const res = await fetch(RELEASES, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rel = await res.json();
    const current = chrome.runtime.getManifest().version;
    await chrome.storage.local.set({
      update: { checkedAt: Date.now(), latest: rel.tag_name, url: rel.html_url, available: isNewer(rel.tag_name, current) },
    });
  } catch {
    await chrome.storage.local.set({ update: { ...update, checkedAt: Date.now() } }); // офлайн — попробуем через 6 ч
  }
}

async function tick() {
  const { state, settings } = await load();
  await updateBadge(state, settings);
  await checkUpdate();
  if (!settings.autoRefresh || !settings.radarUrl) return;

  const { lastRefresh } = await chrome.storage.session.get("lastRefresh");
  // первый тик после запуска только засекает время — вкладка и так только что загрузилась
  if (!lastRefresh) return chrome.storage.session.set({ lastRefresh: Date.now() });
  // тик раз в минуту плавает на секунды — допуск 15 с, иначе интервал растягивается на лишнюю минуту
  if (Date.now() - lastRefresh < Math.max(2, settings.refreshMin) * 60000 - 15000) return;

  const tabs = await chrome.tabs.query({ url: "https://x.com/*" });
  const radar = tabs.find((t) => t.url && t.url.split("?")[0] === settings.radarUrl.split("?")[0]);
  if (!radar) return;
  // Не дёргаем вкладку, которую ты прямо сейчас читаешь.
  const win = await chrome.windows.get(radar.windowId);
  if (radar.active && win.focused) return;

  await chrome.tabs.reload(radar.id);
  await chrome.storage.session.set({ lastRefresh: Date.now() });
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings) serial(async () => {
    const { state, settings } = await load();
    await updateBadge(state, settings);
  });
});
