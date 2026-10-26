// Один поисковый запрос X покрывает сразу много аккаунтов: (from:a OR from:b ...).
// У запроса есть лимит длины, поэтому режем список на куски.

const SUFFIX = " -is:reply -is:retweet"; // только оригинальные посты: под ними и надо отвечать

export function buildQueries(handles: string[], maxLen = 480): string[] {
  const queries: string[] = [];
  let group: string[] = [];

  const render = (g: string[]) => `(${g.map((h) => `from:${h}`).join(" OR ")})${SUFFIX}`;

  for (const h of handles) {
    if (group.length && render([...group, h]).length > maxLen) {
      queries.push(render(group));
      group = [];
    }
    group.push(h);
  }
  if (group.length) queries.push(render(group));
  return queries;
}
