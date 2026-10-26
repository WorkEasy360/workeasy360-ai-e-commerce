"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { formatMoney } from "@workeasy/commerce";
import { Badge, Card, CopyIcon, Page, PageHeader, PaymentIcon, RevenueIcon, StatCard } from "@workeasy/ui/react";
import { Dialog } from "@workeasy/ui/client";
import { api, ApiError, errorMessage } from "../../../../lib/api";
import { moduleByKey } from "../../../../lib/modules";
import { PAYMENT_LABELS, PROVIDER_LABELS } from "../../../../lib/orders";
import { useStore } from "../store-shell";
import { TaxCard } from "./tax-card";

type Provider = "razorpay" | "stripe";

interface Account {
  provider: Provider;
  mode: "test" | "live";
  publicKey: string;
  secretKeyHint: string;
  enabled: boolean;
  updatedAt: string;
}

interface AccountsResponse {
  accounts: Account[];
  webhookUrls: Record<Provider, string>;
  configured: boolean;
}

interface Finances {
  summary: {
    collectedMinor: number;
    refundedMinor: number;
    netMinor: number;
    outstandingMinor: number;
    outstandingOrders: number;
    byProvider: Partial<Record<"razorpay" | "stripe" | "manual", { totalMinor: number; count: number }>>;
    since: string;
    currency: string;
  };
  entries: Array<{
    id: string;
    kind: "payment" | "refund";
    orderId: string;
    orderNumber: number;
    customer: string;
    provider: "razorpay" | "stripe" | "manual";
    method: string | null;
    status: string;
    amountMinor: number;
    currency: string;
    mode: "test" | "live";
    at: string;
  }>;
  page: number;
  more: boolean;
}

const PROVIDERS: Record<Provider, { name: string; blurb: string; publicLabel: string; publicHint: string; secretLabel: string; events: string; dashboard: string }> = {
  razorpay: {
    name: "Razorpay",
    blurb: "UPI, cards, netbanking and wallets. Best for shoppers in India; used for rupee payments when connected.",
    publicLabel: "Key id",
    publicHint: "rzp_test_… or rzp_live_…",
    secretLabel: "Key secret",
    events: "payment.captured, refund.processed and refund.failed",
    dashboard: "Razorpay Dashboard → Account & Settings → API keys, and Webhooks",
  },
  stripe: {
    name: "Stripe",
    blurb: "Cards and wallets worldwide, on Stripe's hosted checkout page.",
    publicLabel: "Publishable key",
    publicHint: "pk_test_… or pk_live_…",
    secretLabel: "Secret key",
    events: "checkout.session.completed, checkout.session.expired, refund.updated and refund.failed",
    dashboard: "Stripe Dashboard → Developers → API keys, and Webhooks",
  },
};

function fieldErrors(err: unknown): Record<string, string> {
  return err instanceof ApiError && err.problem.errors ? Object.fromEntries(err.problem.errors.map((e) => [e.field, e.message])) : {};
}

function CopyField({ label, value }: { label: string; value: string }) {
  const id = useId();
  const [copied, setCopied] = useState(false);
  return (
    <div className="c-field">
      <label className="c-label" htmlFor={id}>
        {label}
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <input id={id} className="c-input" readOnly value={value} onFocus={(e) => e.target.select()} />
        <button
          type="button"
          className="c-btn"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => setCopied(true));
          }}
        >
          <CopyIcon size={14} /> {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

/** Connect or update a gateway with the merchant's own keys. Secrets are write-only: blank keeps the saved one. */
function ConnectDialog({ storeId, provider, account, webhookUrl, onDone, onClose }: { storeId: string; provider: Provider; account: Account | undefined; webhookUrl: string; onDone: () => void; onClose: () => void }) {
  const ids = { pub: useId(), secret: useId(), hook: useId() };
  const p = PROVIDERS[provider];
  const [publicKey, setPublicKey] = useState(account?.publicKey ?? "");
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [enabled, setEnabled] = useState(account?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function save() {
    setBusy(true);
    setError(undefined);
    setErrors({});
    try {
      await api(`/api/v1/stores/${storeId}/payment-accounts/${provider}`, {
        method: "PUT",
        body: { publicKey, enabled, ...(secretKey ? { secretKey } : {}), ...(webhookSecret ? { webhookSecret } : {}) },
      });
      onDone();
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const field = (id: string, name: string, label: string, value: string, set: (v: string) => void, hint: string, secret = false) => (
    <div className="c-field">
      <label className="c-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="c-input"
        value={value}
        onChange={(e) => set(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        {...(secret ? { type: "password" } : {})}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={`${id}-hint`}
      />
      <p id={`${id}-hint`} className={errors[name] ? "c-error" : "c-hint"}>
        {errors[name] ?? hint}
      </p>
    </div>
  );

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={account ? `${p.name} settings` : `Connect ${p.name}`}
      footer={
        <>
          <button type="button" className="c-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="c-btn c-btn-primary" disabled={busy || !publicKey.trim() || (!account && (!secretKey.trim() || !webhookSecret.trim()))} onClick={() => void save()}>
            {busy ? "Checking keys…" : account ? "Save" : `Connect ${p.name}`}
          </button>
        </>
      }
    >
      <p className="c-muted" style={{ marginTop: 0 }}>
        Payments go straight to your own {p.name} account. Find your keys in {p.dashboard}. Use test keys first to try a payment end to end.
      </p>
      {field(ids.pub, "publicKey", p.publicLabel, publicKey, setPublicKey, p.publicHint)}
      {field(ids.secret, "secretKey", p.secretLabel, secretKey, setSecretKey, account ? `Saved (${account.secretKeyHint}). Leave blank to keep it.` : "Stored encrypted. Never shown again.", true)}
      <CopyField label={`Webhook URL: add this in ${p.name}`} value={webhookUrl} />
      <p className="c-hint" style={{ marginTop: -8 }}>
        Send these events: {p.events}.
      </p>
      {field(ids.hook, "webhookSecret", "Webhook signing secret", webhookSecret, setWebhookSecret, account ? "Saved. Leave blank to keep it." : `The secret ${p.name} shows for the webhook above.`, true)}
      <label className="c-inline-check">
        <input type="checkbox" className="c-check-input" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Offer {p.name} at checkout
      </label>
      {error && Object.keys(errors).length === 0 && (
        <p role="alert" className="c-error">
          {error}
        </p>
      )}
    </Dialog>
  );
}

/** Payments & Finances: connected gateways, takings, and every payment and refund. */
export function PaymentsView() {
  const ctx = useStore();
  const mod = moduleByKey("payments");
  const [accounts, setAccounts] = useState<AccountsResponse | undefined>();
  const [fin, setFin] = useState<Finances | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [editing, setEditing] = useState<Provider | undefined>();
  const [removing, setRemoving] = useState<Provider | undefined>();
  const storeId = ctx?.store.id;

  const refreshAccounts = useCallback(() => {
    if (!storeId) return;
    api<AccountsResponse>(`/api/v1/stores/${storeId}/payment-accounts`)
      .then(setAccounts)
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [storeId]);

  useEffect(() => {
    refreshAccounts();
  }, [refreshAccounts]);

  useEffect(() => {
    if (!storeId) return;
    api<Finances>(`/api/v1/stores/${storeId}/finances`)
      .then(setFin)
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [storeId]);

  if (!ctx) return null;
  const { base, can, store } = ctx;
  const locale = `${store.defaultLocale}-${store.country}`;
  const money = (m: number, currency = store.currency) => formatMoney(m, currency, locale);
  const manage = can("payments.manage");

  async function more() {
    if (!fin) return;
    try {
      const next = await api<Finances>(`/api/v1/stores/${store.id}/finances?page=${fin.page + 1}`);
      setFin({ ...next, entries: [...fin.entries, ...next.entries] });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function disconnect(provider: Provider) {
    try {
      await api(`/api/v1/stores/${store.id}/payment-accounts/${provider}`, { method: "DELETE" });
      setRemoving(undefined);
      refreshAccounts();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const s = fin?.summary;
  const testOnly = accounts?.accounts.length && accounts.accounts.every((a) => a.mode === "test");

  return (
    <Page>
      <PageHeader title={mod.label} eyebrow={mod.group} subtitle={mod.summary} />
      {error && (
        <p role="alert" className="c-error" style={{ marginBottom: 12 }}>
          {error}
        </p>
      )}

      <div className="c-stats" style={{ marginBottom: 20 }}>
        <StatCard label="Collected, last 30 days" icon={<RevenueIcon size={16} />} value={s ? money(s.collectedMinor) : "…"} foot={s ? `${Object.values(s.byProvider).reduce((n, p) => n + (p?.count ?? 0), 0)} payments` : undefined} />
        <StatCard label="Refunded" value={s ? money(s.refundedMinor) : "…"} />
        <StatCard label="Net" value={s ? money(s.netMinor) : "…"} />
        <StatCard
          label="Awaiting payment"
          value={s ? money(s.outstandingMinor) : "…"}
          foot={
            s && s.outstandingOrders > 0 ? (
              <a href={`${base}/orders`}>
                {s.outstandingOrders} open order{s.outstandingOrders === 1 ? "" : "s"}
              </a>
            ) : undefined
          }
        />
      </div>

      <Card title="Online payments">
        {accounts && !accounts.configured && (
          <p className="c-error" role="status">
            Online payments aren&apos;t set up on this server yet: the operator needs to add the encryption key for payment credentials (see the deployment guide).
          </p>
        )}
        <div className="c-provider-grid">
          {(["razorpay", "stripe"] as const).map((provider) => {
            const p = PROVIDERS[provider];
            const account = accounts?.accounts.find((a) => a.provider === provider);
            return (
              <div key={provider} className="c-provider">
                <div className="c-provider-head">
                  <span className="c-provider-logo" aria-hidden="true">
                    <PaymentIcon size={18} />
                  </span>
                  <strong>{p.name}</strong>
                  {account ? (
                    <span style={{ display: "inline-flex", gap: 6 }}>
                      <Badge tone={account.enabled ? "success" : "neutral"}>{account.enabled ? "Connected" : "Turned off"}</Badge>
                      {account.mode === "test" && <Badge tone="warning">Test mode</Badge>}
                    </span>
                  ) : (
                    <Badge>Not connected</Badge>
                  )}
                </div>
                <p className="c-muted" style={{ margin: 0 }}>
                  {p.blurb}
                </p>
                {account && (
                  <p className="c-hint" style={{ margin: 0 }}>
                    {p.publicLabel} {account.publicKey} · {p.secretLabel.toLowerCase()} {account.secretKeyHint}
                  </p>
                )}
                {manage && accounts?.configured && (
                  <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
                    <button type="button" className={`c-btn c-btn-sm${account ? "" : " c-btn-primary"}`} onClick={() => setEditing(provider)}>
                      {account ? "Settings" : `Connect ${p.name}`}
                    </button>
                    {account && (
                      <button type="button" className="c-btn c-btn-sm c-btn-ghost" onClick={() => setRemoving(provider)}>
                        Disconnect
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="c-hint" style={{ marginBottom: 0 }}>
          Shoppers who pay online have 30 minutes to finish; unpaid orders are then cancelled and their stock released. Cash, UPI, bank transfer and chat orders are set up in{" "}
          <a href={`${base}/settings/checkout`}>Settings → Checkout</a>.
        </p>
      </Card>

      <TaxCard storeId={store.id} canEdit={manage} />

      <Card title="Transactions" flush>
        <div className="c-table-wrap">
          <table className="c-table c-table-stack">
            <caption className="c-visually-hidden">Payments and refunds</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Order</th>
                <th scope="col">Type</th>
                <th scope="col">Via</th>
                <th scope="col">Status</th>
                <th scope="col" className="c-num">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {fin === undefined ? (
                <tr>
                  <td colSpan={6}>
                    <div className="c-skeleton" role="status" aria-label="Loading transactions" />
                  </td>
                </tr>
              ) : fin.entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="c-muted" style={{ textAlign: "center", padding: 32 }}>
                    No payments yet. Online payments appear here as they arrive; offline ones when you mark an order paid.
                  </td>
                </tr>
              ) : (
                fin.entries.map((e) => (
                  <tr key={`${e.kind}-${e.id}`}>
                    <td data-label="Date">{new Date(e.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</td>
                    <td data-label="Order">
                      <a className="c-cell-title" href={`${base}/orders/${e.orderId}`}>
                        #{e.orderNumber}
                      </a>
                      <span className="c-cell-sub">{e.customer}</span>
                    </td>
                    <td data-label="Type">{e.kind === "payment" ? "Payment" : "Refund"}</td>
                    <td data-label="Via">
                      {e.provider === "manual"
                        ? e.kind === "refund"
                          ? "Returned outside the store"
                          : (PAYMENT_LABELS[e.method as keyof typeof PAYMENT_LABELS] ?? "Offline payment")
                        : `${PROVIDER_LABELS[e.provider]}${e.method ? ` · ${e.method}` : ""}`}
                      {e.mode === "test" && (
                        <>
                          {" "}
                          <Badge tone="warning">Test</Badge>
                        </>
                      )}
                    </td>
                    <td data-label="Status">
                      <Badge tone={e.status === "succeeded" ? "success" : e.status === "failed" ? "danger" : "warning"}>{e.status === "succeeded" ? (e.kind === "payment" ? "Received" : "Refunded") : e.status === "failed" ? "Failed" : "Processing"}</Badge>
                    </td>
                    <td data-label="Amount" className="c-num" style={e.kind === "refund" ? { color: "var(--we-color-danger)" } : undefined}>
                      {e.kind === "refund" ? "−" : ""}
                      {money(e.amountMinor, e.currency)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {fin?.more && (
          <div className="c-pager">
            <button type="button" className="c-btn" onClick={() => void more()}>
              Show more
            </button>
          </div>
        )}
      </Card>
      {testOnly ? <p className="c-hint">Test-mode payments are listed but not counted in your takings.</p> : null}

      {editing && accounts && (
        <ConnectDialog
          storeId={store.id}
          provider={editing}
          account={accounts.accounts.find((a) => a.provider === editing)}
          webhookUrl={accounts.webhookUrls[editing]}
          onClose={() => setEditing(undefined)}
          onDone={() => {
            setEditing(undefined);
            refreshAccounts();
          }}
        />
      )}
      {removing && (
        <Dialog
          open
          onClose={() => setRemoving(undefined)}
          title={`Disconnect ${PROVIDERS[removing].name}?`}
          footer={
            <>
              <button type="button" className="c-btn" onClick={() => setRemoving(undefined)}>
                Keep it
              </button>
              <button type="button" className="c-btn c-btn-danger" onClick={() => void disconnect(removing)}>
                Disconnect
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>Shoppers can no longer pay with {PROVIDERS[removing].name}, and you can&apos;t refund its payments from here until you reconnect. Your saved keys are deleted.</p>
        </Dialog>
      )}
    </Page>
  );
}
