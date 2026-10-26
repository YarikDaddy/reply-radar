// Изолированный мир: мост между страницей (inject.js) и фоном расширения (background.js).
// После обновления расширения старый скрипт в открытой вкладке «отрывается»: chrome.runtime
// пропадает. Тогда тихо отключаемся — новый скрипт придёт с перезагрузкой вкладки.

function onMessage(e) {
  if (e.source !== window || !e.data || e.data.source !== "reply-radar") return;
  if (!chrome.runtime?.id) {
    window.removeEventListener("message", onMessage);
    return;
  }
  try {
    chrome.runtime.sendMessage({ type: "posts", posts: e.data.posts, op: e.data.op || "" }).catch(() => {});
  } catch {
    window.removeEventListener("message", onMessage);
  }
}

window.addEventListener("message", onMessage);
