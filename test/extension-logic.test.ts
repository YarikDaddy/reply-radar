import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyState, ingest, opportunities, replyStats, liveCount, heatLabel } from "../extension/lib/logic.js";

const MIN = 60000;
const now = Date.parse("2026-10-26T09:20:00Z");
const post = (o: any) => ({
  id: "1", text: "hi", author: "marc_lou", authorName: "Marc", followers: 230000, verified: true,
  isReply: false, inReplyTo: null, isRetweet: false, createdAt: now - 5 * MIN,
  metrics: { like_count: 10, reply_count: 2, retweet_count: 1, quote_count: 0, views: 1000 }, ...o,
});

test("свежий пост крупного аккаунта → алерт, один раз", () => {
  const st = emptyState();
  assert.equal(ingest(st, [post({})], {}, now).length, 1);
  assert.equal(ingest(st, [post({ metrics: { like_count: 50, reply_count: 9, retweet_count: 4, quote_count: 0 } })], {}, now + MIN).length, 0);
  assert.equal(st.posts["1"].metrics.like_count, 50, "метрики обновились");
});

test("фильтры: мелкие, старые, реплаи, ретвиты, muted — без алерта; watchlist пробивает порог", () => {
  const st = emptyState();
  const out = ingest(st, [
    post({ id: "small", followers: 500 }),
    post({ id: "old", createdAt: now - 45 * MIN }),
    post({ id: "rep", isReply: true }),
    post({ id: "rt", isRetweet: true }),
    post({ id: "mut", author: "Spammer" }),
    post({ id: "friend", author: "SmallFriend", followers: 300 }),
  ], { muted: ["@spammer"], watchlist: ["smallfriend"] }, now);
  assert.deepEqual(out.map((p: any) => p.id), ["friend"]);
});

test("мега-аккаунт: пока нет истории — алерт, потом только горячие", () => {
  const st = emptyState();
  const mega = (id: string, likes: number, age = 5) => post({ id, author: "sama", followers: 3_000_000, createdAt: now - age * MIN, metrics: { like_count: likes, reply_count: 0, retweet_count: 0, quote_count: 0 } });
  assert.equal(ingest(st, [mega("a", 100), mega("b", 100), mega("c", 100)], {}, now).length, 3, "учимся");
  assert.equal(ingest(st, [mega("cold", 110)], {}, now).length, 0, "обычный пост — тишина");
  const hot = ingest(st, [mega("hot", 500)], {}, now);
  assert.equal(hot.length, 1);
  assert.equal(heatLabel(hot[0].score / hot[0].baseline).icon, "🔥🔥🔥");
});

test("свои реплаи → журнал и подписчики; список окон и счётчик", () => {
  const st = emptyState();
  ingest(st, [
    post({ id: "m1", author: "DaddyYarik", followers: 13, isReply: true, inReplyTo: "solana", text: "@solana Faster than my Wi-Fi", metrics: { like_count: 7, reply_count: 1, retweet_count: 0, quote_count: 0, views: 816 } }),
    post({ id: "m2", author: "daddyyarik", followers: 13, isReply: true, inReplyTo: "levelsio", metrics: { like_count: 1, reply_count: 0, retweet_count: 0, quote_count: 0, views: 40 } }),
    post({ id: "x" }),
  ], { me: "@DaddyYarik" }, now);
  ingest(st, [post({ id: "m3", author: "DaddyYarik", followers: 18, text: "my post" })], { me: "DaddyYarik" }, now + 2 * 60 * MIN);

  const s = replyStats(st, now + 2 * 60 * MIN);
  assert.deepEqual(s.top.map((r: any) => r.id), ["m1", "m2"]);
  assert.equal(s.todayViews, 856);
  assert.equal(s.followers, 18);
  assert.equal(s.followersDelta, 5);

  assert.equal(liveCount(st, {}, now), 1);
  assert.equal(liveCount(st, {}, now + 30 * MIN), 0, "окно протухло");
  assert.equal(opportunities(st, {}, now + 30 * MIN).length, 1, "но ещё видно серым");
  assert.equal(opportunities(st, {}, now + 2 * 60 * MIN).length, 0);
});

test("толпа: под постом уже много ответов → без алерта; 0 = лимит выключен", () => {
  const crowded = post({ id: "c", metrics: { like_count: 500, reply_count: 200, retweet_count: 0, quote_count: 0 } });
  assert.equal(ingest(emptyState(), [crowded], {}, now).length, 0);
  assert.equal(ingest(emptyState(), [crowded], { maxReplies: 0 }, now).length, 1);
});

test("темы, стоп-слова и язык: мусор отсекаем, watchlist пробивает тему", async () => {
  const { findWord, looksEnglish } = await import("../extension/lib/logic.js");
  assert.equal(findWord("I said hi", ["ai"]), null, "ai не ловится внутри said");
  assert.equal(findWord("New AI agent!", ["ai"]), "ai");
  assert.equal(findWord("buy $SOL", ["$sol"]), "$sol");
  assert.equal(looksEnglish("2026 TWICE MOMO [모모헤지] 이벤트 안내 2026 TWICE MOMO"), false);
  assert.equal(looksEnglish("Every man wants this feeling https://t.co/x"), true);

  const st = emptyState();
  const out = ingest(st, [
    post({ id: "ai", text: "Shipped my first AI agent today" }),
    post({ id: "gm", text: "gm ct have a productive week" }),
    post({ id: "kpop", text: "이벤트 안내 모모헤지 이벤트 안내 이벤트" }),
    post({ id: "off", text: "Which memecoin should I buy" }),
    post({ id: "friend", author: "Friend", text: "lunch time", followers: 100 }),
  ], { topics: ["ai", "agent"], watchlist: ["friend"] }, now);
  assert.deepEqual(out.map((p: any) => p.id), ["ai", "friend"]);
  assert.equal(st.posts["ai"].topic, "ai");
});

test("окно: сколько осталось, толпа; лучшие аккаунты для реплаев", () => {
  const st = emptyState();
  ingest(st, [post({ id: "w", createdAt: now - 5 * MIN, metrics: { like_count: 1, reply_count: 12, retweet_count: 0, quote_count: 0 } })], {}, now);
  const [o] = opportunities(st, { maxAgeMin: 20 }, now);
  assert.equal(o.windowLeft, 0.75);
  assert.equal(o.crowd, "ok");

  const me = (id: string, to: string, views: number) => post({ id, author: "me", isReply: true, inReplyTo: to, metrics: { like_count: 0, reply_count: 0, retweet_count: 0, quote_count: 0, views } });
  ingest(st, [me("1", "solana", 800), me("2", "solana", 200), me("3", "marclou", 900), me("4", "me", 5000)], { me: "me" }, now);
  const best = replyStats(st, now, "me").bestAccounts;
  assert.deepEqual(best.map((b: any) => [b.author, b.avg]), [["marclou", 900], ["solana", 500]], "свои треды не считаем");
});

test("цена места: 💎 и сортировка — где реплай увидят больше людей; закрытые ответы отсекаем", async () => {
  const { spotOf } = await import("../extension/lib/logic.js");
  assert.equal(spotOf({ views: 66000, reply_count: 29 }), 2200, "кейс JYPETWICE");
  assert.equal(spotOf({ views: null, reply_count: 3 }), null);

  const st = emptyState();
  const m = (views: number, replies: number) => ({ like_count: 1, reply_count: replies, retweet_count: 0, quote_count: 0, views });
  ingest(st, [
    post({ id: "busy", metrics: m(1500, 11) }),
    post({ id: "gem", metrics: m(66000, 29) }),
    post({ id: "closed", metrics: m(60000, 0), restricted: true }),
  ], { maxReplies: 0 }, now);
  const list = opportunities(st, {}, now);
  assert.deepEqual(list.map((o: any) => o.id), ["gem", "busy"]);
  assert.equal(list[0].gem, true);
  assert.equal(list[1].gem, false);
});

test("цель дня и серия: считаем по местным дням, свои треды не в счёт; старое состояние пересчитывается", async () => {
  const { goalStats, dayKey } = await import("../extension/lib/logic.js");
  const at = (d: number, h = 12) => new Date(2026, 9, d, h).getTime();
  const st: any = emptyState();
  const reply = (id: string, ts: number, to = "solana") => post({ id, author: "me", isReply: true, inReplyTo: to, createdAt: ts });
  const g = { me: "me", dailyGoal: 2 };
  ingest(st, [reply("a", at(24)), reply("b", at(24, 20)), reply("c", at(25)), reply("d", at(25, 9)), reply("self", at(26), "me")], g, at(26));
  assert.equal(st.days[dayKey(at(24))], 2);
  assert.deepEqual(goalStats(st, g, at(26)), { today: 0, goal: 2, streak: 2, done: false }, "сегодня не добито — серия жива со вчера");
  ingest(st, [reply("e", at(26, 13)), reply("f", at(26, 14)), reply("e", at(26, 13))], g, at(26, 15));
  assert.deepEqual(goalStats(st, g, at(26, 15)), { today: 2, goal: 2, streak: 3, done: true }, "повторно увиденный реплай не считаем");
  assert.equal(goalStats(st, g, at(28)).streak, 0, "пропустил день — серия сгорела");

  const old: any = emptyState();
  delete old.days;
  old.replies.x = { id: "x", inReplyTo: "solana", createdAt: at(26), metrics: {} };
  ingest(old, [], g, at(26));
  assert.equal(old.days[dayKey(at(26))], 1);
});

test("ответил под постом → ✓ replied, не в счётчике окон; лучшие часы", async () => {
  const { bestHours } = await import("../extension/lib/logic.js");
  const st = emptyState();
  ingest(st, [post({ id: "t1" }), post({ id: "t2" })], {}, now);
  assert.equal(liveCount(st, {}, now), 2);
  ingest(st, [post({ id: "r1", author: "me", isReply: true, inReplyTo: "marc_lou", inReplyToId: "t1" })], { me: "me" }, now);
  assert.equal(st.posts["t1"].replied, true);
  assert.equal(liveCount(st, {}, now), 1);
  assert.equal(opportunities(st, {}, now)[0].id, "t2", "неотвеченное окно сверху");

  const h = (hr: number, views: number, id: string) => post({ id, author: "me", isReply: true, inReplyTo: "x", createdAt: new Date(2026, 9, 26, hr, 30).getTime(), metrics: { like_count: 0, reply_count: 0, retweet_count: 0, quote_count: 0, views } });
  const s2 = emptyState();
  ingest(s2, [h(21, 900, "a"), h(21, 500, "b"), h(13, 40, "c")], { me: "me" }, now);
  const bh = bestHours(s2, "me");
  assert.equal(bh.best.h, 21);
  assert.equal(bh.best.avg, 700);
  assert.equal(bh.hours[13].count, 1);
});

test("почему пусто: свежие посты и чем отсечены; выключенное авто-обновление", async () => {
  const { emptyReason } = await import("../extension/lib/logic.js");
  const d: any = {};
  ingest(emptyState(), [
    post({ id: "small", followers: 100 }),
    post({ id: "off", text: "lunch was great today honestly" }),
    post({ id: "old", createdAt: now - 50 * MIN }),
    post({ id: "rep", isReply: true }),
  ], { topics: ["ai"] }, now, d);
  assert.deepEqual(d.fresh, { small: "followers", off: "topic" }, "старые и реплаи не считаем свежими окнами");
  assert.equal(Math.round(d.newestAge), 5);

  const r = emptyReason({ scanned: 40, ...d }, { radarUrl: "https://x.com/i/lists/1", autoRefresh: false });
  assert.deepEqual(r.tips, ["autoRefresh", "filter:followers"]);
  assert.deepEqual(emptyReason({ scanned: 12, newestAge: 28, fresh: {} }, {}).tips, ["nothingFresh"]);
  assert.deepEqual(emptyReason(null, {}).tips, ["noScan"]);
});
