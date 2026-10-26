import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQueries } from "../src/query.ts";

test("один запрос, если влезает", () => {
  assert.deepEqual(buildQueries(["a", "b"]), ["(from:a OR from:b) -is:reply -is:retweet"]);
});

test("режет на куски по лимиту длины и никого не теряет", () => {
  const handles = Array.from({ length: 40 }, (_, i) => `account_number_${i}`);
  const qs = buildQueries(handles, 200);
  assert.ok(qs.length > 1);
  for (const q of qs) assert.ok(q.length <= 200, q);
  const back = qs.flatMap((q) => [...q.matchAll(/from:(\w+)/g)].map((x) => x[1]));
  assert.deepEqual(back, handles);
});
