import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport } from "../src/report.ts";

const now = new Date("2026-10-25T20:00:00Z");
const reply = (text: string, views: number, to: string) => ({
  id: text, text, createdAt: now, author: "DaddyYarik", inReplyTo: to,
  metrics: { like_count: 1, reply_count: 0, retweet_count: 0, quote_count: 0, impression_count: views },
});

test("сортирует по просмотрам и считает прирост подписчиков", () => {
  const out = buildReport(
    [reply("@levelsio meh", 50, "levelsio"), reply("@solana Faster than my Wi-Fi", 364, "solana")],
    [{ t: "2026-10-25T01:00:00Z", n: 5 }, { t: "2026-10-25T19:00:00Z", n: 9 }],
    now,
  );
  assert.match(out, /Реплаи за 24 ч: 2/);
  assert.match(out, /Подписчики: 9 \(\+4\)/);
  assert.ok(out.indexOf("Faster") < out.indexOf("meh"));
  assert.ok(!out.includes("@solana Faster"), "упоминание в начале реплая срезаем");
});

test("пустой день", () => {
  assert.match(buildReport([], [], now), /Ни одного реплая/);
});
