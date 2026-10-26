"use client";

import { useState } from "react";
import { ChatIcon, CopyIcon } from "@workeasy/ui/react";
import { useI18n } from "../../../../../components/i18n";

/**
 * Sends a chat order. WhatsApp opens with the message filled in; Telegram
 * can't pre-fill a chat, so the message is copied for pasting first.
 */
export function ChatButton({ chat, storeName }: { chat: { channel: "whatsapp" | "telegram"; url: string; message: string }; storeName: string }) {
  const [copied, setCopied] = useState(false);
  const { t } = useI18n();
  const telegram = chat.channel === "telegram";

  async function copy() {
    try {
      await navigator.clipboard.writeText(chat.message);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="sf-step" aria-labelledby="chat-h" style={{ textAlign: "center", justifyItems: "center" }}>
      <h2 id="chat-h" style={{ justifyContent: "center" }}>
        {t("chat.title", { store: storeName })}
      </h2>
      <p className="c-muted" style={{ margin: 0, maxWidth: "52ch" }}>
        {telegram ? t("chat.telegramHint") : t("chat.whatsappHint")}
      </p>
      <a
        className={`sf-btn ${telegram ? "sf-btn-tg" : "sf-btn-wa"}`}
        href={chat.url}
        target="_blank"
        rel="noreferrer"
        onClick={() => {
          if (telegram) void copy();
        }}
      >
        <ChatIcon size={18} /> {telegram ? t("chat.telegramButton") : t("chat.whatsappButton")}
      </a>
      <details style={{ width: "100%", textAlign: "left" }}>
        <summary style={{ cursor: "pointer", fontSize: 14 }}>{t("chat.see")}</summary>
        <div className="sf-instructions" style={{ marginTop: 8 }}>
          {chat.message}
        </div>
        <button type="button" className="c-btn c-btn-sm" style={{ marginTop: 8 }} onClick={() => void copy()}>
          <CopyIcon size={14} /> {copied ? t("chat.copied") : t("chat.copy")}
        </button>
      </details>
    </section>
  );
}
