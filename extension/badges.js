// Метки радара прямо в ленте X: рядом со временем поста — «📡 💎 2.2K/spot · 9m left».
// Только DOM своей вкладки: ничего не кликаем и не отправляем. Логику берём из lib/logic.js.

(async () => {
  if (!chrome.runtime?.id) return;
  const { DEFAULTS, emptyState, opportunities } = await import(chrome.runtime.getURL("lib/logic.js"));

  const CLASS = "rr-badge";
  const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K" : String(n));
  let byId = new Map();
  let settings = { ...DEFAULTS };

  async function refresh() {
    if (!chrome.runtime?.id) return stop(); // расширение обновили — этот скрипт оторван
    const got = await chrome.storage.local.get(["state", "settings"]);
    settings = { ...DEFAULTS, ...got.settings };
    const list = settings.inFeedBadges ? opportunities(got.state || emptyState(), settings, Date.now()) : [];
    byId = new Map(list.filter((o) => o.live || o.replied).map((o) => [o.id, o]));
    decorateAll();
  }

  // id поста — из ссылки на его время (/user/status/123). Первая ссылка — сам пост, не цитата внутри.
  function linkOf(article) {
    const time = article.querySelector('a[href*="/status/"] time');
    return time ? time.closest("a") : null;
  }

  function label(o) {
    if (o.replied) return { text: "📡 ✓ replied", bg: "rgba(0,186,124,.15)", fg: "#00ba7c" };
    const left = Math.max(1, Math.ceil(settings.maxAgeMin - o.ageMin));
    const spot = o.spot !== null ? `${fmt(o.spot)}/spot · ` : "";
    if (o.gem) return { text: `📡 💎 ${spot}${left}m left`, bg: "linear-gradient(90deg, rgba(29,155,240,.25), rgba(0,186,124,.25))", fg: "#b9f2ff" };
    return { text: `📡 ${spot}${left}m left`, bg: "rgba(29,155,240,.14)", fg: "#1d9bf0" };
  }

  function decorate(article) {
    const link = linkOf(article);
    const id = link && (link.getAttribute("href").match(/\/status\/(\d+)/) || [])[1];
    const o = id && byId.get(id);
    let badge = article.querySelector(`.${CLASS}`);
    if (!o) return badge?.remove();
    const { text, bg, fg } = label(o);
    if (!badge) {
      badge = document.createElement("span");
      badge.className = CLASS;
      badge.style.cssText =
        "display:inline-flex;align-items:center;margin-left:6px;padding:1px 8px;border-radius:999px;" +
        "font:600 12px/18px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;white-space:nowrap;vertical-align:middle;";
      badge.title = "Reply Radar: open reply window";
      link.insertAdjacentElement("afterend", badge);
    }
    if (badge.textContent !== text) badge.textContent = text;
    badge.style.background = bg;
    badge.style.color = fg;
  }

  function decorateAll() {
    for (const a of document.querySelectorAll('article[data-testid="tweet"]')) decorate(a);
  }

  // X дорисовывает ленту при скролле — догоняем новые посты, но не чаще раза в 300 мс.
  let pending = 0;
  const observer = new MutationObserver(() => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = 0;
      decorateAll();
    }, 300);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  const onChange = (changes) => {
    if (changes.state || changes.settings) refresh();
  };
  chrome.storage.onChanged.addListener(onChange);
  const timer = setInterval(refresh, 30000); // «Nm left» тикает

  function stop() {
    observer.disconnect();
    clearInterval(timer);
    document.querySelectorAll(`.${CLASS}`).forEach((b) => b.remove());
  }

  refresh();
})();
