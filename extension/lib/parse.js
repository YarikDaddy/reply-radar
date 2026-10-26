// Достаёт посты из JSON-ответов, которые X и так присылает твоему браузеру (GraphQL ленты).
// Никаких своих запросов к X: читаем только то, что страница уже загрузила.
//
// Схема GraphQL у X часто меняется, поэтому не завязываемся на путь до постов,
// а обходим весь JSON и узнаём пост по форме: rest_id + legacy.created_at + legacy.full_text.
// Классический скрипт (не модуль): грузится в мир страницы перед inject.js.

(function (root) {
  function userOf(tweet) {
    const u = tweet.core && tweet.core.user_results && tweet.core.user_results.result;
    if (!u) return null;
    const legacy = u.legacy || {};
    return {
      id: u.rest_id,
      username: (u.core && u.core.screen_name) || legacy.screen_name,
      name: (u.core && u.core.name) || legacy.name,
      followers: legacy.followers_count ?? (u.relationship_counts && u.relationship_counts.followers) ?? 0,
      avatar: (u.avatar && u.avatar.image_url) || legacy.profile_image_url_https || null,
      verified: Boolean(u.is_blue_verified),
    };
  }

  function toPost(t) {
    const l = t.legacy;
    const user = userOf(t);
    if (!user || !user.username) return null;
    const note = t.note_tweet && t.note_tweet.note_tweet_results && t.note_tweet.note_tweet_results.result;
    return {
      id: t.rest_id,
      text: (note && note.text) || l.full_text,
      createdAt: new Date(l.created_at).getTime(),
      author: user.username,
      authorName: user.name,
      avatar: user.avatar,
      followers: user.followers,
      verified: user.verified,
      isReply: Boolean(l.in_reply_to_status_id_str),
      inReplyTo: l.in_reply_to_screen_name || null,
      inReplyToId: l.in_reply_to_status_id_str || null,
      isRetweet: Boolean(l.retweeted_status_result),
      // автор ограничил, кто может отвечать — такой пост для реплая бесполезен
      restricted: Boolean(l.conversation_control || t.limitedActionResults),
      metrics: {
        like_count: l.favorite_count || 0,
        reply_count: l.reply_count || 0,
        retweet_count: l.retweet_count || 0,
        quote_count: l.quote_count || 0,
        views: t.views && t.views.count ? Number(t.views.count) : null,
      },
    };
  }

  // Реклама: X вставляет промо-посты прямо в ленту и списки, у элемента есть promotedMetadata.
  // Два признака: promotedMetadata рядом с tweet_results или entryId вида "promoted-tweet-…".
  function promotedId(node) {
    let holder = null;
    if (node.promotedMetadata && node.tweet_results) holder = node;
    else if (typeof node.entryId === "string" && node.entryId.startsWith("promoted")) holder = node.content && node.content.itemContent;
    const r = holder && holder.tweet_results && holder.tweet_results.result;
    return (r && (r.rest_id || (r.tweet && r.tweet.rest_id))) || null;
  }

  function extractPosts(json) {
    const found = new Map();
    const promoted = new Set();
    const stack = [json];
    let guard = 0;
    while (stack.length && guard++ < 200000) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      const ad = promotedId(node);
      if (ad) promoted.add(ad);
      if (typeof node.rest_id === "string" && node.legacy && node.legacy.created_at && "full_text" in node.legacy) {
        const p = toPost(node);
        if (p && !Number.isNaN(p.createdAt)) found.set(p.id, p);
      }
      for (const k in node) {
        const v = node[k];
        if (v && typeof v === "object") stack.push(v);
      }
    }
    for (const id of promoted) if (found.has(id)) found.get(id).promoted = true;
    return [...found.values()];
  }

  root.RRParse = { extractPosts };
})(globalThis);
