const { settings } = await chrome.storage.local.get("settings");
if (settings?.me) document.querySelector("#handle").textContent = `@${settings.me} · building in public`;
