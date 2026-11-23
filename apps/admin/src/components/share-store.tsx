"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@workeasy/ui/client";
import { ChatIcon, CopyIcon, DownloadIcon, ExternalIcon } from "@workeasy/ui/react";

/**
 * Share the store: its link, a WhatsApp message with the link, and a QR
 * code to print or download as a PNG. The QR code points at the store's
 * public address, so it keeps working as long as that address does.
 */
export function ShareStoreDialog({ open, onClose, url, storeName, slug }: { open: boolean; onClose: () => void; url: string; storeName: string; slug: string }) {
  const [qr, setQr] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Loaded only when the dialog opens, so the dashboard doesn't carry the QR encoder.
    // A large, high-contrast code with a quiet zone, so it scans from print and screens alike.
    import("qrcode")
      .then(({ default: QRCode }) => QRCode.toDataURL(url, { width: 640, margin: 2, errorCorrectionLevel: "M", color: { dark: "#0F2B2F", light: "#FFFFFF" } }))
      .then((data) => !cancelled && setQr(data))
      .catch(() => !cancelled && setQr(undefined));
    return () => {
      cancelled = true;
    };
  }, [open, url]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`Shop at ${storeName}: ${url}`)}`;

  return (
    <Dialog open={open} onClose={onClose} title="Share your store">
      <div style={{ display: "grid", gap: 16, justifyItems: "center", textAlign: "center" }}>
        <div style={{ width: 220, height: 220, borderRadius: 16, border: "1px solid var(--we-border)", display: "grid", placeItems: "center", background: "#fff", overflow: "hidden" }}>
          {qr ? <img src={qr} width={208} height={208} alt={`QR code for ${url}`} /> : <div className="c-skeleton" style={{ width: 180, height: 180 }} />}
        </div>
        <p className="c-muted" style={{ margin: 0 }}>
          Shoppers scan this with their phone camera to open {storeName}. Print it for your counter, packaging or flyers.
        </p>
        <div className="c-input-group" style={{ width: "100%" }}>
          <input className="c-input" readOnly value={url} aria-label="Store link" onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="c-btn" style={{ borderRadius: 0, border: 0, borderLeft: "1px solid var(--we-border)" }} onClick={() => void copy()}>
            <CopyIcon size={16} /> {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
          <a className="c-btn c-btn-primary" href={qr} download={`${slug}-qr.png`} aria-disabled={!qr} onClick={(e) => !qr && e.preventDefault()}>
            <DownloadIcon size={16} /> Download QR code
          </a>
          <a className="c-btn" href={whatsapp} target="_blank" rel="noreferrer">
            <ChatIcon size={16} /> Share on WhatsApp
          </a>
          <a className="c-btn" href={url} target="_blank" rel="noreferrer">
            <ExternalIcon size={16} /> Open store
          </a>
        </div>
      </div>
    </Dialog>
  );
}
