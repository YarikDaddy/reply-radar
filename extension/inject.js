// Мир страницы x.com. Подслушиваем ответы fetch/XHR к GraphQL и пересылаем найденные посты
// в content.js через postMessage. Запросы не меняем и новых не делаем.

(function () {
  const GRAPHQL = /\/i\/api\/graphql\//;
  // Имя операции из URL (/i/api/graphql/<hash>/ListLatestTweetsTimeline) — откуда пришли посты.
  const opOf = (url) => (String(url).split("?")[0].match(/\/graphql\/[^/]+\/([A-Za-z]+)/) || [])[1] || "";
  const send = (posts, url) => {
    if (posts.length) window.postMessage({ source: "reply-radar", posts, op: opOf(url) }, location.origin);
  };
  const handle = (text, url) => {
    try {
      send(globalThis.RRParse.extractPosts(JSON.parse(text)), url);
    } catch {
      // не JSON или неожиданная форма — молча пропускаем, страница должна работать как обычно
    }
  };

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const url = args[0] instanceof Request ? args[0].url : String(args[0]);
      if (url && GRAPHQL.test(url)) res.clone().text().then((t) => handle(t, url), () => {});
    } catch {}
    return res;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (GRAPHQL.test(String(url))) {
      this.addEventListener("load", () => {
        if (this.responseType === "" || this.responseType === "text") handle(this.responseText, url);
        else if (this.responseType === "json" && this.response) send(globalThis.RRParse.extractPosts(this.response), url);
      });
    }
    return origOpen.call(this, method, url, ...rest);
  };
})();
