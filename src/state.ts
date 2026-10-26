// Состояние между запусками — обычный JSON-файл. Для v0 на ноуте этого хватает.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface State {
  lastEnd?: string; // до какого момента уже прочитали ленту (ISO)
  history: Record<string, number[]>; // автор → скоры его последних постов
  spend: { day: string; usd: number };
  followers: { t: string; n: number }[];
}

const FILE = new URL(process.env.FAKE === "1" ? "../state.demo.json" : "../state.json", import.meta.url);

export function loadState(): State {
  if (!existsSync(FILE)) return { history: {}, spend: { day: today(), usd: 0 }, followers: [] };
  return JSON.parse(readFileSync(FILE, "utf8"));
}

export function saveState(s: State): void {
  writeFileSync(FILE, JSON.stringify(s, null, 2));
}

export function today(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}
