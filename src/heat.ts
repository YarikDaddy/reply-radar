// «Жар» поста: насколько быстро он набирает реакцию по сравнению с обычными постами того же автора.
// Чистые функции — без сети и файлов, поэтому легко тестируются.

export interface Metrics {
  like_count: number;
  reply_count: number;
  retweet_count: number;
  quote_count: number;
}

export type Tier = "always" | "hot";

const HISTORY_SIZE = 20;
const MIN_SAMPLES = 3;

// Вовлечение в минуту. Реплаи и репосты весят больше лайков — как в алгоритме X.
export function score(m: Metrics, ageMin: number): number {
  const engagement = m.like_count + 3 * m.reply_count + 2 * m.retweet_count + 2 * m.quote_count;
  return engagement / Math.max(ageMin, 1);
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Во сколько раз пост горячее медианы автора. null — истории ещё мало, сравнивать не с чем.
export function heat(s: number, history: number[]): number | null {
  if (history.length < MIN_SAMPLES) return null;
  const base = median(history);
  if (base === 0) return s > 0 ? Infinity : 1;
  return s / base;
}

// always — средние аккаунты, там реплай видно всегда, шлём каждый свежий пост.
// hot — мега-аккаунты, под ними тонешь в сотнях ответов; шлём только когда пост реально летит
// (или пока копим историю автора).
export function shouldAlert(tier: Tier, h: number | null, minHeat: number): boolean {
  if (tier === "always") return true;
  return h === null || h >= minHeat;
}

export function pushHistory(history: number[], s: number): number[] {
  return [...history, s].slice(-HISTORY_SIZE);
}
