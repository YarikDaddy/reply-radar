// Журнал реплаев: какие твои ответы за сутки собрали просмотры и сколько подписчиков прибавилось.
// X такого не показывает — а без этого долбишь вслепую.

import type { Post, XClient } from "./x.ts";
import type { State } from "./state.ts";
import { escapeHtml } from "./telegram.ts";

export function buildReport(replies: Post[], followers: State["followers"], now = new Date()): string {
  const dayAgo = now.getTime() - 24 * 3600_000;
  const recent = followers.filter((f) => new Date(f.t).getTime() >= dayAgo);
  const nowN = followers.at(-1)?.n;
  const delta = recent.length >= 2 ? recent.at(-1)!.n - recent[0].n : null;

  const lines = [`<b>📊 Реплаи за 24 ч: ${replies.length}</b>`];
  if (nowN !== undefined) lines.push(`Подписчики: ${nowN}${delta !== null ? ` (${delta >= 0 ? "+" : ""}${delta})` : ""}`);

  const top = [...replies].sort((a, b) => (b.metrics.impression_count ?? 0) - (a.metrics.impression_count ?? 0));
  for (const r of top.slice(0, 10)) {
    const m = r.metrics;
    const snippet = escapeHtml(r.text.replace(/^(@\w+\s*)+/, "").slice(0, 60));
    lines.push(`👁 ${m.impression_count ?? "?"} ❤ ${m.like_count} 💬 ${m.reply_count} · @${r.inReplyTo ?? "?"}\n   «${snippet}»`);
  }
  if (replies.length === 0) lines.push("Ни одного реплая. Цель — 10–15 в день.");
  return lines.join("\n");
}

export async function fetchReport(x: XClient, me: string, state: State): Promise<string> {
  const end = new Date(Date.now() - 15_000); // end_time должен быть чуть в прошлом
  const start = new Date(end.getTime() - 24 * 3600_000);
  const replies = await x.search(`from:${me} is:reply`, start, end);
  return buildReport(replies, state.followers);
}
