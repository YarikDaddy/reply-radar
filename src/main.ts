// Reply Radar v0: раз в N минут смотрим свежие посты нужных аккаунтов и шлём в Telegram те,
// под которыми стоит ответить прямо сейчас.

import { readFileSync } from "node:fs";
import { heat, pushHistory, score, shouldAlert, type Tier } from "./heat.ts";
import { buildQueries } from "./query.ts";
import { fetchReport } from "./report.ts";
import { loadState, saveState, today, type State } from "./state.ts";
import { escapeHtml, Telegram } from "./telegram.ts";
import { FakeX, RealX, type Post, type XClient } from "./x.ts";

interface Config {
  me: string;
  pollEveryMin: number;
  delayMin: number;
  minHeat: number;
  dailyBudgetUsd: number;
  accounts: Record<Tier, string[]>;
}

const config: Config = JSON.parse(readFileSync(new URL("../config.json", import.meta.url), "utf8"));
const fake = process.env.FAKE === "1";
if (!fake && !process.env.X_BEARER_TOKEN) {
  console.error("Нет X_BEARER_TOKEN в .env. Для демо без токена: npm run demo");
  process.exit(1);
}
const x: XClient = fake ? new FakeX() : new RealX(process.env.X_BEARER_TOKEN!);
const tg = new Telegram(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID);
const state: State = loadState();

const tierOf = new Map<string, Tier>();
for (const tier of ["always", "hot"] as Tier[]) {
  for (const h of config.accounts[tier]) tierOf.set(h.toLowerCase(), tier);
}
const queries = buildQueries([...tierOf.keys()]);
const MIN = 60_000;
let budgetWarned = false;

// Окно чтения: [lastEnd, сейчас − delay]. Задержка нужна, чтобы пост успел набрать
// первые реакции — тогда одного чтения хватает и чтобы найти пост, и чтобы оценить жар.
function nextWindow(now: Date): { start: Date; end: Date } {
  const end = new Date(now.getTime() - config.delayMin * MIN);
  const earliest = new Date(end.getTime() - (config.pollEveryMin + 15) * MIN); // после сна ноута не тянем бэклог
  const last = state.lastEnd ? new Date(state.lastEnd) : new Date(end.getTime() - config.pollEveryMin * MIN);
  return { start: last > earliest ? last : earliest, end };
}

function track(spentBefore: number): void {
  if (state.spend.day !== today()) state.spend = { day: today(), usd: 0 };
  state.spend.usd += x.spentUsd - spentBefore;
}

async function tick(): Promise<void> {
  if (state.spend.day !== today()) state.spend = { day: today(), usd: 0 };
  if (state.spend.usd >= config.dailyBudgetUsd) {
    if (!budgetWarned) await tg.send(`💸 Дневной бюджет $${config.dailyBudgetUsd} исчерпан, радар спит до завтра.`);
    budgetWarned = true;
    return;
  }
  budgetWarned = false;

  const now = new Date();
  const { start, end } = nextWindow(now);
  if (end <= start) return;
  const before = x.spentUsd;

  const posts: Post[] = [];
  for (const q of queries) posts.push(...(await x.search(q, start, end)));
  posts.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  for (const p of posts) {
    const author = p.author.toLowerCase();
    const tier = tierOf.get(author) ?? "always";
    const ageMin = (now.getTime() - p.createdAt.getTime()) / MIN;
    const s = score(p.metrics, ageMin);
    const h = heat(s, state.history[author] ?? []);
    state.history[author] = pushHistory(state.history[author] ?? [], s);
    if (shouldAlert(tier, h, config.minHeat)) await tg.send(...alert(p, ageMin, h));
  }

  // Подписчики раз в час — чтобы в отчёте видеть прирост.
  const lastSnap = state.followers.at(-1);
  if (!lastSnap || now.getTime() - new Date(lastSnap.t).getTime() >= 60 * MIN) {
    state.followers.push({ t: now.toISOString(), n: await x.followers(config.me) });
    state.followers = state.followers.slice(-24 * 14);
  }

  state.lastEnd = end.toISOString();
  track(before);
  saveState(state);
  console.log(`${now.toLocaleTimeString()} постов: ${posts.length}, сегодня потрачено $${state.spend.usd.toFixed(3)}`);
}

function alert(p: Post, ageMin: number, h: number | null): [string, { text: string; url: string }[]] {
  const m = p.metrics;
  const flame = h === null ? "🆕" : h >= 3 ? "🔥🔥🔥" : h >= config.minHeat ? "🔥" : "•";
  const heatLabel = h === null ? "копим историю" : `x${h === Infinity ? "∞" : h.toFixed(1)} к обычному`;
  const text =
    `${flame} <b>@${escapeHtml(p.author)}</b> · ${Math.round(ageMin)} мин назад · ${heatLabel}\n` +
    `${escapeHtml(p.text.slice(0, 280))}\n` +
    `❤ ${m.like_count} 💬 ${m.reply_count} 🔁 ${m.retweet_count}`;
  return [
    text,
    [
      { text: "✍️ Ответить", url: `https://x.com/intent/post?in_reply_to=${p.id}` },
      { text: "Открыть", url: `https://x.com/${p.author}/status/${p.id}` },
    ],
  ];
}

async function handle(cmd: string): Promise<void> {
  if (cmd === "/report") {
    const before = x.spentUsd;
    await tg.send(await fetchReport(x, config.me, state));
    track(before);
    saveState(state);
  } else if (cmd === "/status") {
    const n = tierOf.size;
    await tg.send(`📡 Слежу за ${n} аккаунтами, опрос раз в ${config.pollEveryMin} мин.\nСегодня потрачено $${state.spend.usd.toFixed(3)} из $${config.dailyBudgetUsd}.`);
  } else {
    await tg.send("/report — реплаи за сутки\n/status — что отслеживаю и расход");
  }
}

async function safe(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
  }
}

if (process.env.ONCE === "1") {
  await safe(tick);
  await safe(() => handle("/report"));
} else {
  await tg.send(`📡 Reply Radar запущен: ${tierOf.size} аккаунтов, раз в ${config.pollEveryMin} мин.`);
  await safe(tick);
  setInterval(() => safe(tick), config.pollEveryMin * MIN);
  while (true) {
    await safe(async () => {
      for (const cmd of await tg.nextCommands()) await handle(cmd);
    });
    if (!tg.enabled) await new Promise((r) => setTimeout(r, 60 * MIN));
  }
}
