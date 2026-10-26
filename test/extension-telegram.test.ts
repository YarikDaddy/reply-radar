import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMessage, wantsTelegram } from "../extension/lib/telegram.js";
import { DEFAULTS } from "../extension/lib/logic.js";

const now = Date.parse("2026-10-26T13:00:00Z");
const post = (o: any = {}) => ({
  id: "777", author: "cyrilXBT", followers: 197000, createdAt: now - 6 * 60000, text: "Never let the agent that found a bug <be> the one that fixes it",
  baseline: null, score: 3, metrics: { like_count: 40, reply_count: 2, retweet_count: 1, quote_count: 0, views: 6000 }, ...o,
});
const tg = { ...DEFAULTS, maxAgeMin: 20, tgEnabled: true, tgToken: "1:a", tgChatId: "42" };

test("в Telegram по умолчанию — только 💎; без токена/выключено — ничего", () => {
  assert.equal(wantsTelegram(post(), tg), true, "6000/3 = 2000 → гем");
  assert.equal(wantsTelegram(post({ metrics: { ...post().metrics, reply_count: 40 } }), tg), false);
  assert.equal(wantsTelegram(post({ metrics: { ...post().metrics, reply_count: 40 } }), { ...tg, tgMode: "all" }), true);
  assert.equal(wantsTelegram(post(), { ...tg, tgEnabled: false }), false);
  assert.equal(wantsTelegram(post(), { ...tg, tgChatId: "" }), false);
});

test("сообщение: гем, экранирование HTML, оставшееся окно, кнопки в X", () => {
  const { text, buttons } = buildMessage(post(), tg, now);
  assert.match(text, /^💎 <b>Hidden gem<\/b> · <b>@cyrilXBT<\/b> · 197K followers · 6m/);
  assert.match(text, /&lt;be&gt;/, "текст поста не ломает HTML-разметку Telegram");
  assert.match(text, /👁 ~2K per reply spot/);
  assert.match(text, /⏱ 14 min left/);
  assert.deepEqual(buttons.map((b: any) => b.url), ["https://x.com/cyrilXBT/status/777", "https://x.com/intent/post?in_reply_to=777"]);
});
