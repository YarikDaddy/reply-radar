import { findChatId, sendMessage } from "./lib/telegram.js";
import { DEFAULTS, TOPIC_PRESETS, emptyState, opportunities, replyStats, heatLabel, ago, goalStats, bestHours, emptyReason, isOnboarded } from "./lib/logic.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = (n) => (n === null || n === undefined ? "—" : n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : n >= 1e4 ? Math.round(n / 1e3) + "K" : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K" : String(n));
const TICK = `<svg class="tick" viewBox="0 0 22 22" aria-label="verified"><path fill="#1d9bf0" d="M20.4 11c0-1.3-.8-2.5-2-3 .4-1.3.1-2.7-.8-3.6-1-.9-2.3-1.2-3.6-.8-.5-1.2-1.7-2-3-2s-2.5.8-3 2c-1.3-.4-2.7-.1-3.6.8-.9 1-1.2 2.3-.8 3.6-1.2.5-2 1.7-2 3s.8 2.5 2 3c-.4 1.3-.1 2.7.8 3.6 1 .9 2.3 1.2 3.6.8.5 1.2 1.7 2 3 2s2.5-.8 3-2c1.3.4 2.7.1 3.6-.8.9-1 1.2-2.3.8-3.6 1.2-.5 2-1.7 2-3z"/><path fill="#fff" d="M9.6 14.6 6.4 11.4l1.3-1.3 1.9 1.9 4.7-5 1.3 1.3z"/></svg>`;

let state = emptyState();
let settings = { ...DEFAULTS };
let meta = { seen: 0 };
let snoozeUntil = 0;
let tgError = null;
let rawSettings = {};
let update = {};

async function load() {
  const got = await chrome.storage.local.get(["state", "settings", "meta", "snoozeUntil"]);
  snoozeUntil = got.snoozeUntil || 0;
  tgError = (await chrome.storage.local.get("tgError")).tgError || null;
  state = got.state || emptyState();
  rawSettings = got.settings || {};
  update = (await chrome.storage.local.get("update")).update || {};
  settings = { ...DEFAULTS, ...rawSettings };
  meta = got.meta || { seen: 0 };
}

function avatar(url, name) {
  const letter = esc((name || "?").replace(/^@/, "")[0]?.toUpperCase() || "?");
  return url ? `<img class="ava" src="${esc(url.replace("_normal.", "_bigger."))}" alt="" data-letter="${letter}">` : `<div class="ava">${letter}</div>`;
}

// CSP расширения запрещает inline onerror — подменяем битые аватарки буквой вручную.
function fixAvatars(root) {
  for (const img of root.querySelectorAll("img.ava")) {
    img.addEventListener("error", () => {
      const d = document.createElement("div");
      d.className = "ava";
      d.textContent = img.dataset.letter;
      img.replaceWith(d);
    }, { once: true });
  }
}

const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function renderUpdate() {
  const el = $("#update");
  const current = chrome.runtime.getManifest().version;
  el.hidden = !(update.available && update.url && update.latest?.replace(/^v/, "") !== current);
  if (el.hidden) return;
  el.href = update.url;
  el.textContent = `⬆ Reply Radar ${update.latest} is out (you have v${current}) — download →`;
}

function renderHeader(now, live) {
  renderUpdate();
  const snoozed = snoozeUntil > now;
  $("#snooze").textContent = snoozed ? "🔕" : "🔔";
  $("#snooze").title = snoozed ? `Notifications paused until ${clock(snoozeUntil)} — click to resume` : "Pause notifications for 1 hour";
  $("#snooze").classList.toggle("off", snoozed);
  const fresh = meta.lastAt && now - meta.lastAt < 5 * 60000;
  $("#pulse").classList.toggle("live", Boolean(fresh));
  $("#status").textContent = meta.lastAt
    ? `${fresh ? "Live" : "Idle"} · ${fmt(meta.seen)} posts scanned · ${ago((now - meta.lastAt) / 60000)}${now - meta.lastAt < 60000 ? "" : " ago"}`
    : "Open x.com to start scanning";
  if (snoozed) $("#status").textContent = `Paused until ${clock(snoozeUntil)}`;
  $("#count").hidden = !live;
  $("#count").textContent = live;
}

const CROWD = { early: "early — top spot", ok: "getting busy", crowded: "crowded" };

function renderNow() {
  const now = Date.now();
  const list = opportunities(state, settings, now);
  const live = list.filter((o) => o.live).length;
  renderHeader(now, list.filter((o) => o.live && !o.replied).length);
  const g = goalStats(state, settings, now);
  const goal = settings.me
    ? `<div class="goal${g.done ? " done" : ""}"><div class="goal-top"><span><b>${g.today}</b>/${g.goal} replies today${g.done ? " — done 🎯" : ""}</span>
        <span>${g.streak ? `🔥 ${g.streak}-day streak` : "start a streak"}</span></div>
        <div class="bar"><i style="width:${Math.min(100, Math.round((g.today / g.goal) * 100))}%"></i></div></div>`
    : "";

  if (!list.length) {
    $("#now").innerHTML = goal + `<div class="empty"><div class="radar"></div><b>Scanning for reply windows</b>${whyEmpty(now)}</div>`;
    return;
  }
  $("#now").innerHTML = goal + list
    .map((o) => {
      const h = heatLabel(o.heat);
      const heatCls = o.heat === null ? "new" : o.heat >= 1.5 ? "" : "calm";
      const m = o.metrics;
      const left = Math.max(0, settings.maxAgeMin - o.ageMin);
      const color = o.windowLeft > 0.5 ? "var(--green)" : o.windowLeft > 0.2 ? "var(--amber)" : "var(--red)";
      const url = `https://x.com/${esc(o.author)}/status/${esc(o.id)}`;
      const open = o.live && !o.replied;
      return `<article class="card${open ? "" : " cold"}${o.gem && open ? " gem" : ""}">
        <a href="${url}" target="_blank">${avatar(o.avatar, o.authorName || o.author)}</a>
        <div>
          <div class="head">
            <a class="name" href="${url}" target="_blank">${esc(o.authorName || o.author)}</a>${o.verified ? TICK : ""}
            <span class="handle">@${esc(o.author)} · ${ago(o.ageMin)}</span>
            <span class="heat ${heatCls}">${h.icon} ${o.heat === null ? "new" : esc(h.text.replace(" vs usual", ""))}</span>
          </div>
          <div class="text">${esc(o.text.replace(/\s*\n\s*\n\s*/g, "\n").trim())}</div>
          <div class="chips">
            <span class="chip">${fmt(o.followers)} followers</span>
            <span class="chip ${o.crowd}">💬 ${fmt(m.reply_count)} · ${CROWD[o.crowd]}</span>
            ${o.spot !== null ? `<span class="chip ${o.gem ? "gem" : ""}" title="Post views per reply spot: how many people will likely see your reply">${o.gem ? "💎 hidden gem · " : "👁 "}${fmt(o.spot)} per spot</span>` : ""}
            ${o.topic ? `<span class="chip topic">#${esc(o.topic)}</span>` : ""}
            ${o.replied ? `<span class="chip early">✓ replied</span>` : ""}
            <span>❤ ${fmt(m.like_count)}</span>
          </div>
          <div class="foot">
            <div class="timer"><div class="bar"><i style="width:${Math.round(o.windowLeft * 100)}%;background:${color}"></i></div>
              <small>${o.replied ? "you replied — nice" : o.live ? `${Math.ceil(left)} min left in the reply window` : "window closed"}</small></div>
            <a class="reply" href="https://x.com/intent/post?in_reply_to=${esc(o.id)}" target="_blank">${o.replied ? "Again" : "Reply"}</a>
          </div>
        </div>
      </article>`;
    })
    .join("");
  fixAvatars($("#now"));
}

const REASON = {
  followers: "too small (Min followers)",
  topic: "off-topic (Topics)",
  language: "not English",
  muteWords: "mute words",
  muted: "muted accounts",
  crowded: "too many replies already",
  calm: "mega account, not hot",
  replied: "you already replied",
};

// Вместо пустой заглушки — объяснение, почему пусто, и что поменять.
function whyEmpty(now) {
  const batches = (meta.diag || []).filter((b) => now - b.t < 60 * 60000);
  const diag = { scanned: 0, newestAge: null, fresh: {} };
  for (const b of batches) {
    diag.scanned += b.scanned;
    if (b.newestAge !== null) diag.newestAge = Math.min(diag.newestAge ?? Infinity, b.newestAge);
    Object.assign(diag.fresh, b.fresh);
  }
  const r = emptyReason(diag, settings);
  const tips = [];
  if (r.tips.includes("autoRefresh")) tips.push(`<li class="warn">⚠️ <b>Auto-refresh is off</b> — your radar tab never loads new posts. Settings → Radar tab → turn it on.</li>`);
  if (r.tips.includes("noScan")) tips.push(`<li>Nothing scanned in the last hour. Open your X list in a tab.</li>`);
  if (r.tips.includes("nothingFresh"))
    tips.push(`<li>Nothing fresh: the newest post was <b>${Math.round(r.newestAge)} min</b> old (window: ${settings.maxAgeMin} min). Your feed is quiet or not refreshing — US accounts post ~9am–9pm New York time.</li>`);
  const f = r.tips.find((t) => t.startsWith("filter:"));
  if (f) tips.push(`<li>Fresh posts were filtered out — mostly <b>${REASON[f.slice(7)] || f.slice(7)}</b>.</li>`);
  const counts = Object.entries(r.counts).map(([k, n]) => `${n} ${REASON[k] || k}`).join(" · ");
  return `<div class="diag"><div class="diag-head">Last hour: <b>${r.scanned}</b> posts scanned · <b>${r.fresh}</b> fresh${counts ? `<br><small>${esc(counts)}</small>` : ""}</div>
    ${tips.length ? `<ul>${tips.join("")}</ul>` : ""}</div>`;
}

function renderMine() {
  if (!settings.me) {
    $("#mine").innerHTML = `<div class="empty"><b>Set your handle first</b>Settings → Your handle. Then open your profile → Replies now and then: views and likes of your replies get picked up automatically.</div>`;
    return;
  }
  const st = replyStats(state, Date.now(), settings.me);
  const d = st.followersDelta;
  let html = `<div class="stats">
    <div class="stat"><div>${st.todayCount}</div><small>replies · 24h</small></div>
    <div class="stat"><div>${fmt(st.todayViews)}</div><small>views · 24h</small></div>
    <div class="stat"><div>${fmt(st.followers)}${d ? ` <span class="up">${d > 0 ? "+" : ""}${d}</span>` : ""}</div><small>followers</small></div>
  </div>`;

  if (st.bestAccounts.length) {
    const max = st.bestAccounts[0].avg || 1;
    html += `<h3>Best accounts to reply under</h3><div class="best">${st.bestAccounts
      .map((b) => `<div class="row"><a href="https://x.com/${esc(b.author)}" target="_blank">@${esc(b.author)}</a>
        <div class="meter"><i style="width:${Math.max(4, Math.round((b.avg / max) * 100))}%"></i></div>
        <span class="v">${fmt(b.avg)} avg</span></div>`)
      .join("")}</div>`;
  }

  const bh = bestHours(state, settings.me);
  if (bh.best) {
    const max = Math.max(...bh.hours.map((b) => b.avg)) || 1;
    html += `<h3>When your replies get seen</h3><div class="hours">${bh.hours
      .map((b) => `<div class="hcol${b.h === bh.best.h ? " top" : ""}" title="${String(b.h).padStart(2, "0")}:00 — ${b.count} replies, ${fmt(b.avg)} avg views"><i style="height:${b.count ? Math.max(6, Math.round((b.avg / max) * 100)) : 0}%"></i></div>`)
      .join("")}</div><div class="hours-axis"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span></div>
      <p class="hours-note">Best so far: <b>${String(bh.best.h).padStart(2, "0")}:00–${String((bh.best.h + 1) % 24).padStart(2, "0")}:00</b> · ${fmt(bh.best.avg)} avg views (${bh.best.count} ${bh.best.count === 1 ? "reply" : "replies"})</p>`;
  }

  html += `<h3>Top replies</h3>`;
  html += st.top.length
    ? st.top
        .map((r) => `<div class="mine"><div class="to">to <a href="https://x.com/${esc(settings.me)}/status/${esc(r.id)}" target="_blank">@${esc(r.inReplyTo)}</a> · ${ago((Date.now() - r.createdAt) / 60000)} ago</div>
          <div class="text">${esc(r.text.replace(/^(@\w+\s*)+/, ""))}</div>
          <div class="chips"><span>👁 ${fmt(r.metrics.views)}</span><span>❤ ${fmt(r.metrics.like_count)}</span><span>💬 ${fmt(r.metrics.reply_count)}</span></div></div>`)
        .join("")
    : `<div class="empty">No replies tracked yet. Open <a href="https://x.com/${esc(settings.me)}/with_replies" target="_blank">your Replies tab</a> once.</div>`;
  $("#mine").innerHTML = html;
}

const list = (v) => (Array.isArray(v) ? v : []).join(", ");
const listLines = (v) => (Array.isArray(v) ? v : []).join("\n");

function fillForm() {
  const f = $("#form");
  for (const [k, v] of Object.entries(settings)) {
    const el = f.elements[k];
    if (!el) continue;
    if (el.type === "checkbox") el.checked = Boolean(v);
    else if (k === "topics" || k === "muteWords") el.value = list(v);
    else el.value = Array.isArray(v) ? listLines(v) : v;
  }
}

$("#presets").innerHTML = Object.keys(TOPIC_PRESETS).map((k) => `<button type="button" data-preset="${esc(k)}">+ ${esc(k)}</button>`).join("");
$("#presets").addEventListener("click", (e) => {
  const name = e.target.dataset?.preset;
  if (!name) return;
  const ta = $("#form").topics;
  const have = ta.value.split(",").map((x) => x.trim()).filter(Boolean);
  ta.value = [...new Set([...have, ...TOPIC_PRESETS[name]])].join(", ");
});

$("#form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const handles = (s) => s.split(/[\s,]+/).map((x) => x.replace(/^@/, "")).filter(Boolean);
  const words = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const num = (v, d) => (v === "" || Number.isNaN(Number(v)) ? d : Number(v));
  const next = {
    ...settings,
    me: f.me.value.replace(/^@/, "").trim(),
    dailyGoal: Math.max(1, num(f.dailyGoal.value, DEFAULTS.dailyGoal)),
    minFollowers: num(f.minFollowers.value, DEFAULTS.minFollowers),
    maxAgeMin: Math.max(1, num(f.maxAgeMin.value, DEFAULTS.maxAgeMin)),
    maxReplies: Math.max(0, num(f.maxReplies.value, DEFAULTS.maxReplies)),
    hotFollowers: num(f.hotFollowers.value, DEFAULTS.hotFollowers),
    gemSpot: Math.max(1, num(f.gemSpot.value, DEFAULTS.gemSpot)),
    minHeat: num(f.minHeat.value, DEFAULTS.minHeat),
    topics: words(f.topics.value),
    muteWords: words(f.muteWords.value),
    englishOnly: f.englishOnly.checked,
    watchlist: handles(f.watchlist.value),
    muted: handles(f.muted.value),
    notify: f.notify.checked,
    inFeedBadges: f.inFeedBadges.checked,
    tgToken: f.tgToken.value.trim(),
    tgEnabled: f.tgEnabled.checked,
    tgMode: f.tgMode.value,
    autoRefresh: f.autoRefresh.checked,
    radarUrl: f.radarUrl.value.trim(),
    refreshMin: Math.max(2, num(f.refreshMin.value, DEFAULTS.refreshMin)),
  };
  await chrome.storage.local.set({ settings: next });
  settings = next;
  $("#saved").textContent = "Saved ✓";
  setTimeout(() => ($("#saved").textContent = ""), 1500);
});

function renderTg() {
  const el = $("#tgStatus");
  if (tgError && settings.tgEnabled) {
    el.className = "tg-status err";
    el.textContent = `Last send failed: ${tgError.message}`;
  } else if (settings.tgChatId && settings.tgToken) {
    el.className = "tg-status ok";
    el.textContent = `Connected ✓${settings.tgBot ? ` @${settings.tgBot}` : ""}`;
  } else {
    el.className = "tg-status";
    el.textContent = "Not connected";
  }
}

$("#tgConnect").addEventListener("click", async () => {
  const token = $("#form").tgToken.value.trim();
  const el = $("#tgStatus");
  if (!token) return void (el.textContent = "Paste the bot token first");
  el.className = "tg-status";
  el.textContent = "Connecting…";
  try {
    const { bot, chatId } = await findChatId(token);
    if (!chatId) {
      el.className = "tg-status err";
      el.textContent = `Open @${bot}, send /start, then press Connect again`;
      return;
    }
    await sendMessage(token, chatId, { text: "✅ <b>Reply Radar connected.</b>\nHidden gems will land here — so you don't miss one from bed." });
    settings = { ...settings, tgToken: token, tgChatId: chatId, tgBot: bot, tgEnabled: true };
    await chrome.storage.local.set({ settings, tgError: null });
    tgError = null;
    fillForm();
    renderTg();
  } catch (e) {
    el.className = "tg-status err";
    el.textContent = /Unauthorized|Not Found/i.test(e.message) ? "Wrong token — copy it again from @BotFather" : e.message;
  }
});

$("#snooze").addEventListener("click", async () => {
  snoozeUntil = snoozeUntil > Date.now() ? 0 : Date.now() + 60 * 60000;
  await chrome.storage.local.set({ snoozeUntil });
  renderNow();
});

$("#share").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("promo.html") }));

async function currentXTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url?.startsWith("https://x.com/") ? tab.url : null;
}

$("#useTab").addEventListener("click", async () => {
  const url = await currentXTab();
  if (!url) return void ($("#saved").textContent = "Open an x.com tab first");
  $("#form").radarUrl.value = url;
  $("#form").autoRefresh.checked = true; // без авто-обновления вкладка-радар не видит новых постов
});

// Онбординг: три шага при первом открытии, чтобы радар сразу заработал, а не молчал на дефолтах.
const NICHES = { ...TOPIC_PRESETS, "Any topic": [] };
const picked = new Set(["AI & builders"]);
let wRadarUrl = "";

function renderNiches() {
  $("#wNiche").innerHTML = Object.keys(NICHES)
    .map((k) => `<button type="button" data-n="${esc(k)}" class="${picked.has(k) ? "on" : ""}">${esc(k)}</button>`)
    .join("");
}

$("#wNiche").addEventListener("click", (e) => {
  const k = e.target.dataset?.n;
  if (!k) return;
  if (k === "Any topic") picked.clear();
  else picked.delete("Any topic");
  picked.has(k) && k !== "Any topic" ? picked.delete(k) : picked.add(k);
  renderNiches();
});

$("#wTab").addEventListener("click", async () => {
  wRadarUrl = (await currentXTab()) || "";
  $("#wTabStatus").className = wRadarUrl ? "tg-status ok" : "tg-status err";
  $("#wTabStatus").textContent = wRadarUrl ? "✓ " + wRadarUrl.replace("https://x.com", "") : "Open an x.com tab first";
});

async function finishOnboarding(skip) {
  const topics = skip ? [] : [...new Set([...picked].flatMap((k) => NICHES[k]))];
  const me = $("#wMe").value.replace(/^@/, "").trim();
  settings = { ...settings, onboarded: true, ...(skip ? {} : { me, topics, radarUrl: wRadarUrl, autoRefresh: Boolean(wRadarUrl) }) };
  await chrome.storage.local.set({ settings });
  document.body.classList.remove("onboarding");
  fillForm();
  renderNow();
  renderMine();
}
$("#wStart").addEventListener("click", () => finishOnboarding(false));
$("#wSkip").addEventListener("click", () => finishOnboarding(true));

for (const b of document.querySelectorAll("nav button")) {
  b.addEventListener("click", () => {
    for (const x of document.querySelectorAll("nav button, section")) x.classList.remove("on");
    b.classList.add("on");
    $("#" + b.dataset.tab).classList.add("on");
  });
}

await load();
if (!isOnboarded(rawSettings)) {
  document.body.classList.add("onboarding");
  renderNiches();
}
fillForm();
renderTg();
renderNow();
renderMine();
chrome.storage.onChanged.addListener(async (changes) => {
  await load();
  renderNow();
  renderMine();
  if (changes.settings) fillForm();
  renderTg();
});
setInterval(renderNow, 15000); // таймеры окон тикают
