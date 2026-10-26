// Клиент X API v2. Pay-per-use: платим за каждый прочитанный пост/профиль,
// поэтому каждый пост читаем ровно один раз и считаем расходы.

import type { Metrics } from "./heat.ts";

export const PRICE_PER_POST = 0.005;
export const PRICE_PER_USER = 0.01;

export interface Post {
  id: string;
  text: string;
  createdAt: Date;
  author: string; // username
  metrics: Metrics & { impression_count?: number };
  inReplyTo?: string; // username, если это реплай
}

export interface XClient {
  search(query: string, start: Date, end: Date): Promise<Post[]>;
  followers(username: string): Promise<number>;
  spentUsd: number;
}

const BASE = "https://api.x.com/2";

export class RealX implements XClient {
  spentUsd = 0;
  private token: string;
  constructor(token: string) {
    this.token = token;
  }

  private async get(path: string, params: Record<string, string>): Promise<any> {
    const url = `${BASE}${path}?${new URLSearchParams(params)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
    if (res.status === 429) throw new Error("X API: rate limit (429), подождём следующего тика");
    if (!res.ok) throw new Error(`X API ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async search(query: string, start: Date, end: Date): Promise<Post[]> {
    const posts: Post[] = [];
    let nextToken: string | undefined;
    do {
      const params: Record<string, string> = {
        query,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        max_results: "100",
        "tweet.fields": "created_at,public_metrics,author_id",
        expansions: "author_id,in_reply_to_user_id",
        "user.fields": "username",
      };
      if (nextToken) params.next_token = nextToken;
      const body = await this.get("/tweets/search/recent", params);

      const users = new Map<string, string>();
      for (const u of body.includes?.users ?? []) users.set(u.id, u.username);
      for (const t of body.data ?? []) {
        posts.push({
          id: t.id,
          text: t.text,
          createdAt: new Date(t.created_at),
          author: users.get(t.author_id) ?? t.author_id,
          metrics: t.public_metrics,
          inReplyTo: t.in_reply_to_user_id ? users.get(t.in_reply_to_user_id) : undefined,
        });
      }
      this.spentUsd += (body.data?.length ?? 0) * PRICE_PER_POST;
      nextToken = body.meta?.next_token;
    } while (nextToken);
    return posts;
  }

  async followers(username: string): Promise<number> {
    const body = await this.get(`/users/by/username/${username}`, { "user.fields": "public_metrics" });
    this.spentUsd += PRICE_PER_USER;
    return body.data.public_metrics.followers_count;
  }
}

// Фейковый X для демо и проверки без токена: выдаёт пару правдоподобных постов.
export class FakeX implements XClient {
  spentUsd = 0;
  async search(query: string, _start: Date, end: Date): Promise<Post[]> {
    const handles = [...query.matchAll(/from:(\w+)/g)].map((m) => m[1]);
    if (/(^|\s)is:reply/.test(query)) {
      return [
        fakePost("r1", handles[0] ?? "me", "Faster than my Wi-Fi", end, 30, { like_count: 3, reply_count: 0, retweet_count: 0, quote_count: 0, impression_count: 364 }, "solana"),
        fakePost("r2", handles[0] ?? "me", "shipping beats planning", end, 90, { like_count: 1, reply_count: 1, retweet_count: 0, quote_count: 0, impression_count: 58 }, "levelsio"),
      ];
    }
    return handles.slice(0, 2).map((h, i) =>
      fakePost(`f${i}`, h, `Just shipped a new feature, took me ${i + 2} hours with AI`, end, 5, {
        like_count: 40 * (i + 1), reply_count: 12, retweet_count: 5, quote_count: 1,
      }),
    );
  }
  async followers(): Promise<number> {
    return 9;
  }
}

function fakePost(id: string, author: string, text: string, now: Date, ageMin: number, metrics: Post["metrics"], inReplyTo?: string): Post {
  return { id, author, text, createdAt: new Date(now.getTime() - ageMin * 60_000), metrics, inReplyTo };
}
