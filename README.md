# Reply Radar

**Know when to reply before everyone else.**

A free Chrome extension for X. It watches what X already loads in your browser and pings you the moment a big account posts — so your reply lands in the first minutes, when it still gets seen.

- 🔔 Desktop notification + badge when a fresh post (≤ 15 min) from an account with 5k+ followers shows up in your feed or list
- 🔥 **Heat**: how fast the post is taking off compared to that author's usual posts. Mega accounts only ping you when a post is actually flying
- 📊 **Reply journal**: which of your replies got views, and how many followers you gained today
- 📡 **Badges right in your X feed** — `💎 2.4K/spot · 11m left` next to the post time, no need to open the popup
- 💎 **Hidden gems**: posts with a big audience and almost no replies — your reply gets seen by almost everyone who opens them
- ⏱ **Reply window** countdown and crowd meter (early / busy / crowded)
- 🎯 **Daily goal + streak**, ✓ marks posts you already replied to (caught the moment you hit Reply — no profile visit needed)
- 🕘 **Best hours**: when your replies get the most views
- 🧹 Topic presets, mute words, English-only filter; skips engagement pods (likes and replies from "their own", almost no views) and promoted posts
- 📱 **Telegram alerts**: hidden gems straight to your phone via your own bot (no server — the extension talks to the Bot API directly)
- ⬆ Tells you when a new version is out (checks GitHub releases every 6 hours)
- 🔕 Snooze notifications for an hour, 📸 share card for your build-in-public posts
- 🔄 Optional auto-refresh of one "radar" tab (e.g. your X list), so it works in the background

**No API, no cost, no servers.** Reply Radar never makes its own requests to X and never posts or replies for you — you write every reply yourself. Nothing leaves your computer, except optional alerts to your own Telegram bot.

## Install (2 minutes)

1. Download **`reply-radar-vX.zip`** from the [latest release](https://github.com/YarikDaddy/reply-radar/releases/latest) and unzip it
2. Open `chrome://extensions`, turn on **Developer mode** (top right)
3. **Load unpacked** → pick the unzipped folder
4. Pin the 📡 icon and open it — a 3-step setup asks for your handle, your niche and your radar tab

Tip: pick **🔎 Niche search** in step 3. It opens X's *Latest* tab for your niche (`(claude OR cursor OR "vibe coding" …) min_faves:10 lang:en`) — fresh posts from everyone in the niche that are already getting likes. Way more reply windows than a small list. Posts from your own X list skip the topic filter: you picked those accounts yourself.

## How it works

`inject.js` runs in the x.com page and listens to the GraphQL responses X sends to your timeline. `lib/parse.js` finds posts in that JSON by their shape (not by a fixed path, because X changes its schema often). `lib/logic.js` decides what is a reply window:

- original post (not a reply or a repost), not older than *max age*
- author has ≥ *min followers*, or is on your watchlist
- heat = (likes + 3·replies + 2·reposts + 2·quotes) per minute ÷ the median of the author's last 20 posts

`background.js` stores state, shows notifications, keeps the badge count and refreshes the radar tab.

## Development

```bash
npm test          # parser + logic tests (Node 24, no dependencies)
npm run pack      # build dist/reply-radar-vX.zip for a GitHub release
```

`src/` holds the paused **API version** (X API pay-per-use → Telegram alerts, `npm run demo`). It's for later, when it makes sense to pay for alerts on your phone.
