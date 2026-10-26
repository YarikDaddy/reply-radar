// Telegram Bot API напрямую через fetch. Без токена — печатаем в консоль (демо-режим).

export interface Button {
  text: string;
  url: string;
}

export class Telegram {
  private offset = 0;
  private token?: string;
  private chatId?: string;
  constructor(token?: string, chatId?: string) {
    this.token = token;
    this.chatId = chatId;
  }

  get enabled(): boolean {
    return Boolean(this.token && this.chatId);
  }

  private async call(method: string, body: object): Promise<any> {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(`Telegram ${method}: ${json.description}`);
    return json.result;
  }

  async send(html: string, buttons: Button[] = []): Promise<void> {
    if (!this.enabled) {
      console.log("\n[TG]", html.replace(/<[^>]+>/g, ""), buttons.map((b) => `\n  [${b.text}] ${b.url}`).join(""));
      return;
    }
    await this.call("sendMessage", {
      chat_id: this.chatId,
      text: html,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: buttons.length ? { inline_keyboard: [buttons] } : undefined,
    });
  }

  // Long polling: ждём команды до 30 с. Принимаем только из своего чата.
  async nextCommands(): Promise<string[]> {
    if (!this.enabled) return [];
    const updates = await this.call("getUpdates", { offset: this.offset, timeout: 30, allowed_updates: ["message"] });
    const cmds: string[] = [];
    for (const u of updates) {
      this.offset = u.update_id + 1;
      if (String(u.message?.chat?.id) === String(this.chatId) && u.message.text?.startsWith("/")) {
        cmds.push(u.message.text.split(/[\s@]/)[0]);
      }
    }
    return cmds;
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
