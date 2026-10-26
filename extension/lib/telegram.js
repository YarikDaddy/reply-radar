// Алерты в Telegram прямо из расширения: Bot API доступен по обычному HTTPS, сервер не нужен.
// Токен и chat id лежат только в chrome.storage.local на твоём компе.

import { ago, heatLabel, heatOf, spotOf } from "./logic.js";

const API = "https://api.telegram.org";
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : n >= 1e3 ? Math.round(n / 1e3) + "K" : String(n));

// Что из алертов уходит в Telegram: только 💎 (по умолчанию — чтобы телефон не разрывался) или всё.
export function wantsTelegram(post, settings) {
  if (!settings.tgEnabled || !settings.tgToken || !settings.tgChatId) return false;
  if (settings.tgMode === "all") return true;
  const spot = spotOf(post.metrics);
  return spot !== null && spot >= settings.gemSpot;
}

export function buildMessage(post, settings, now) {
  const spot = spotOf(post.metrics);
  const gem = spot !== null && spot >= settings.gemSpot;
  const h = heatOf(post);
  const { icon, text } = heatLabel(h);
  const left = Math.max(0, Math.ceil(settings.maxAgeMin - (now - post.createdAt) / 60000));
  const m = post.metrics;
  const lines = [
    `${gem ? "💎 <b>Hidden gem</b> · " : `${icon} `}<b>@${esc(post.author)}</b> · ${fmt(post.followers)} followers · ${ago((now - post.createdAt) / 60000)}`,
    "",
    esc(post.text.length > 500 ? post.text.slice(0, 500) + "…" : post.text),
    "",
    `💬 ${m.reply_count} replies${spot !== null ? ` · 👁 ~${fmt(spot)} per reply spot` : ""}${h === null ? "" : ` · ${text}`}`,
    `⏱ ${left} min left in the reply window`,
  ];
  return {
    text: lines.join("\n"),
    // Ссылка на статус открывает приложение X на телефоне; intent — сразу окно ответа (в браузере).
    buttons: [
      { text: "📱 Open in X", url: `https://x.com/${post.author}/status/${post.id}` },
      { text: "✍️ Reply", url: `https://x.com/intent/post?in_reply_to=${post.id}` },
    ],
  };
}

async function call(token, method, body) {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
  if (!json.ok) throw new Error(json.description || "Telegram error");
  return json.result;
}

export function sendMessage(token, chatId, { text, buttons = [] }) {
  return call(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: buttons.length ? { inline_keyboard: [buttons] } : undefined,
  });
}

// Подключение: пользователь пишет боту /start, мы забираем chat id из последнего сообщения.
export async function findChatId(token) {
  const me = await call(token, "getMe", {});
  const updates = await call(token, "getUpdates", { allowed_updates: ["message"] });
  const last = [...updates].reverse().find((u) => u.message?.chat?.id);
  return { bot: me.username, chatId: last ? String(last.message.chat.id) : null };
}
