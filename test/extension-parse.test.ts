import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { timeline, tweetResult } from "./fixtures/make.js";

// parse.js — классический скрипт для мира страницы; запускаем его в песочнице как браузер.
const ctx: any = {};
ctx.globalThis = ctx;
vm.runInNewContext(readFileSync(new URL("../extension/lib/parse.js", import.meta.url), "utf8"), ctx);
const extractPosts = (j: unknown) => JSON.parse(JSON.stringify(ctx.RRParse.extractPosts(j)));

const now = Date.parse("2026-10-26T09:20:00Z");
const levels = { handle: "levelsio", name: "@levelsio", followers: 700000 };
const marc = { handle: "marc_lou", name: "Marc Lou", followers: 230000 };

test("достаёт посты из ленты: автор, подписчики, метрики, время", () => {
  const json = timeline([tweetResult({ id: "1", user: levels, text: "shipped", createdAt: now - 5 * 60000, likes: 40, replies: 12, rts: 3, views: 9000 })]);
  const [p] = extractPosts(JSON.parse(JSON.stringify(json)));
  assert.equal(p.id, "1");
  assert.equal(p.author, "levelsio");
  assert.equal(p.followers, 700000);
  assert.equal(p.createdAt, now - 5 * 60000);
  assert.deepEqual(p.metrics, { like_count: 40, reply_count: 12, retweet_count: 3, quote_count: 0, views: 9000 });
  assert.equal(p.isReply, false);
});

test("старая форма юзера, обёртка видимости, реплаи, ретвиты и цитируемое внутри", () => {
  const original = tweetResult({ id: "o", user: marc, text: "original", createdAt: now - 60000, oldUserShape: true });
  const json = timeline([
    tweetResult({ id: "rt", user: levels, text: "RT @marc_lou: original", createdAt: now, retweetOf: original }),
    tweetResult({ id: "r", user: levels, text: "@x yes", createdAt: now, inReplyTo: "x", wrapVisibility: true }),
  ]);
  const byId = Object.fromEntries(extractPosts(json).map((p: any) => [p.id, p]));
  assert.equal(byId.rt.isRetweet, true);
  assert.equal(byId.o.author, "marc_lou", "оригинал внутри ретвита тоже находим");
  assert.equal(byId.o.metrics.views, null, "нет счётчика просмотров → null");
  assert.equal(byId.r.isReply, true);
  assert.equal(byId.r.inReplyTo, "x");
  assert.equal(byId.r.inReplyToId, "999");
});

test("закрытые ответы помечаем restricted", () => {
  const t: any = tweetResult({ id: "c", user: marc, text: "closed", createdAt: now });
  t.legacy.conversation_control = { policy: "Community" };
  const open = tweetResult({ id: "o", user: marc, text: "open", createdAt: now });
  const byId = Object.fromEntries(extractPosts(timeline([t, open])).map((p: any) => [p.id, p]));
  assert.equal(byId.c.restricted, true);
  assert.equal(byId.o.restricted, false);
});

test("свой реплай ловится прямо из ответа на отправку (CreateTweet)", () => {
  const me = { handle: "DaddyYarik", name: "Yarik", followers: 14 };
  const json = { data: { create_tweet: { tweet_results: { result: tweetResult({ id: "new1", user: me, text: "@marclou ship it", createdAt: now, inReplyTo: "marclou" }) } } } };
  const [p] = extractPosts(json);
  assert.equal(p.id, "new1");
  assert.equal(p.isReply, true);
  assert.equal(p.author, "DaddyYarik");
});

test("реклама в ленте и списках помечается promoted (оба признака)", () => {
  const ad1: any = timeline([tweetResult({ id: "ad1", user: marc, text: "buy perfume", createdAt: now })]);
  ad1.data.list.tweets_timeline.timeline.instructions[0].entries[0].content.itemContent.promotedMetadata = { advertiser_results: {} };
  const ad2: any = timeline([tweetResult({ id: "ad2", user: marc, text: "buy more", createdAt: now }), tweetResult({ id: "org", user: marc, text: "organic", createdAt: now })]);
  ad2.data.list.tweets_timeline.timeline.instructions[0].entries[0].entryId = "promoted-tweet-ad2-15";
  const byId = Object.fromEntries([...extractPosts(ad1), ...extractPosts(ad2)].map((p: any) => [p.id, p]));
  assert.equal(byId.ad1.promoted, true);
  assert.equal(byId.ad2.promoted, true);
  assert.equal(byId.org.promoted, undefined);
});

test("длинные посты берут текст из note_tweet; мусор не роняет парсер", () => {
  const t: any = tweetResult({ id: "n", user: marc, text: "short…", createdAt: now });
  t.note_tweet = { note_tweet_results: { result: { text: "full long text" } } };
  assert.equal(extractPosts(timeline([t]))[0].text, "full long text");
  assert.deepEqual(extractPosts({ data: { foo: [1, null, "x", { legacy: {} }] } }), []);
  assert.deepEqual(extractPosts(null), []);
});
