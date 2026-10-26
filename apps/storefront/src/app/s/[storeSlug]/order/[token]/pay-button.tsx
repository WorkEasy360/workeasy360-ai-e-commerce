"use client";

import { useState } from "react";
import { useI18n } from "../../../../../components/i18n";
import { pay, startPayment } from "../../../../../lib/pay";

/** For a card order awaiting payment: open the payment, and show how long is left. */
export function PayButton({ slug, token, amount, payBy, provider }: { slug: string; token: string; amount: string; payBy: string | null; provider: "razorpay" | "stripe" | null }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { t, locale } = useI18n();

  async function go() {
    setBusy(true);
    setMessage(null);
    const outcome = await pay(slug, token, await startPayment(slug, token));
    if (outcome.kind === "paid") {
      window.location.replace(`/s/${slug}/order/${token}`);
      return;
    }
    if (outcome.kind === "redirecting") return;
    if (outcome.kind === "error") setMessage(outcome.message);
    setBusy(false);
  }

  const deadline = payBy ? new Date(payBy).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }) : null;
  return (
    <section className="sf-step" aria-labelledby="pay-now-h" style={{ textAlign: "center", justifyItems: "center" }}>
      <h2 id="pay-now-h" style={{ justifyContent: "center" }}>
        {t("payNow.title")}
      </h2>
      <p className="c-muted" style={{ margin: 0, maxWidth: "52ch" }}>
        {deadline ? t("payNow.held", { time: deadline }) : t("payNow.confirm")}
      </p>
      <button type="button" className="sf-btn sf-btn-brand" onClick={() => void go()} disabled={busy}>
        {busy ? t("payNow.opening") : t("payNow.pay", { amount })}
      </button>
      {message && (
        <p className="c-error" role="alert" style={{ margin: 0 }}>
          {message}
        </p>
      )}
      <p className="c-hint" style={{ margin: 0 }}>
        {provider === "stripe" ? t("payNow.stripe") : provider === "razorpay" ? t("payNow.razorpay") : null}
      </p>
    </section>
  );
}
