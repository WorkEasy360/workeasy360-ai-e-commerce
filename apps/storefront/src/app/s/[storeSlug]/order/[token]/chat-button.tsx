"use client";

import { useState } from "react";
import { ChatIcon, CopyIcon } from "@workeasy/ui/react";
import { useI18n } from "../../../../../components/i18n";

/**
 * Messages the shop about a placed order on WhatsApp, with the order details
 * filled in. It's an enquiry: sending it doesn't pay for or change the order.
 */
export function ChatButton({ chat, storeName }: { chat: { channel: "whatsapp"; url: string; message: string }; storeName: string }) {
  const [copied, setCopied] = useState(false);
  const { t } = useI18n();

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
        {t("chat.title")}
      </h2>
      <p className="c-muted" style={{ margin: 0, maxWidth: "52ch" }}>
        {t("chat.whatsappHint", { store: storeName })}
      </p>
      <a className="sf-btn sf-btn-wa" href={chat.url} target="_blank" rel="noreferrer">
        <ChatIcon size={18} /> {t("chat.whatsappButton")}
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
