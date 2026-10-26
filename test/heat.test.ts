import { test } from "node:test";
import assert from "node:assert/strict";
import { heat, median, pushHistory, score, shouldAlert } from "../src/heat.ts";

const m = (like: number, reply = 0, rt = 0, quote = 0) => ({ like_count: like, reply_count: reply, retweet_count: rt, quote_count: quote });

test("score: реплаи весят больше лайков, делим на возраст", () => {
  assert.equal(score(m(10), 5), 2);
  assert.equal(score(m(0, 10), 5), 6);
  assert.equal(score(m(10), 0), 10); // возраст < 1 мин считаем как 1
});

test("median", () => {
  assert.equal(median([]), 0);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
});

test("heat: null пока мало истории, потом отношение к медиане", () => {
  assert.equal(heat(10, [1, 2]), null);
  assert.equal(heat(10, [5, 5, 5]), 2);
  assert.equal(heat(0, [0, 0, 0]), 1);
  assert.equal(heat(1, [0, 0, 0]), Infinity);
});

test("shouldAlert: always шлёт всё, hot — только горячее или пока учимся", () => {
  assert.equal(shouldAlert("always", 0.1, 1.5), true);
  assert.equal(shouldAlert("hot", null, 1.5), true);
  assert.equal(shouldAlert("hot", 1.2, 1.5), false);
  assert.equal(shouldAlert("hot", 2, 1.5), true);
});

test("pushHistory держит последние 20", () => {
  let h: number[] = [];
  for (let i = 0; i < 25; i++) h = pushHistory(h, i);
  assert.equal(h.length, 20);
  assert.equal(h[0], 5);
});
