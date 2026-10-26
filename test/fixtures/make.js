// Генерирует ответ X GraphQL в той форме, в какой его присылает лента/список (окт. 2026).
export function tweetResult({ id, user, text, createdAt, likes = 0, replies = 0, rts = 0, quotes = 0, views, inReplyTo, retweetOf, oldUserShape = false, wrapVisibility = false }) {
  const userResult = oldUserShape
    ? { __typename: "User", rest_id: "u_" + user.handle, is_blue_verified: true, legacy: { screen_name: user.handle, name: user.name, followers_count: user.followers } }
    : { __typename: "User", rest_id: "u_" + user.handle, is_blue_verified: true, core: { screen_name: user.handle, name: user.name, created_at: "Mon Jan 01 00:00:00 +0000 2018" }, legacy: { followers_count: user.followers, description: "" } };
  const legacy = {
    created_at: new Date(createdAt).toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) ([\d:]+) GMT$/, "$1 $3 $2 $5 +0000 $4"),
    full_text: text, favorite_count: likes, reply_count: replies, retweet_count: rts, quote_count: quotes,
    id_str: id, conversation_id_str: id,
  };
  if (inReplyTo) Object.assign(legacy, { in_reply_to_status_id_str: "999", in_reply_to_screen_name: inReplyTo });
  if (retweetOf) legacy.retweeted_status_result = { result: retweetOf };
  const t = { __typename: "Tweet", rest_id: id, core: { user_results: { result: userResult } }, legacy, views: views === undefined ? { state: "Enabled" } : { count: String(views), state: "EnabledWithCount" } };
  return wrapVisibility ? { __typename: "TweetWithVisibilityResults", tweet: t } : t;
}

export function timeline(results) {
  return {
    data: { list: { tweets_timeline: { timeline: { instructions: [
      { type: "TimelineAddEntries", entries: [
        ...results.map((r, i) => ({ entryId: "tweet-" + i, sortIndex: String(1e6 - i), content: { entryType: "TimelineTimelineItem", __typename: "TimelineTimelineItem", itemContent: { itemType: "TimelineTweet", __typename: "TimelineTweet", tweet_results: { result: r } } } })),
        { entryId: "cursor-bottom-1", content: { entryType: "TimelineTimelineCursor", value: "DAABCgAB", cursorType: "Bottom" } },
      ] },
    ] } } } },
  };
}
