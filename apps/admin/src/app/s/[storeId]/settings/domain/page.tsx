"use client";

import { useEffect, useId, useState } from "react";
import { Badge, Card, CopyIcon, EmptyState, GlobeIcon } from "@workeasy/ui/react";
import { api, ApiError, errorMessage, storefrontUrl } from "../../../../../lib/api";
import { useStore } from "../../store-shell";

interface Domain {
  domain: string;
  status: "pending" | "verified";
  verifiedAt: string | null;
  checkedAt: string | null;
  txt: { name: string; value: string };
  cname: string;
}

function Copyable({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="c-dns-row">
      <span className="c-label">{label}</span>
      <code className="c-dns-value">{value}</code>
      <button type="button" className="c-btn c-btn-sm c-btn-ghost" aria-label={`Copy ${label.toLowerCase()} ${value}`} onClick={() => void navigator.clipboard.writeText(value).then(() => setCopied(true))}>
        <CopyIcon size={13} /> {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** A custom domain for the shop: claim it, add two DNS records, verify. */
export default function DomainPage() {
  const ctx = useStore();
  const id = useId();
  const [domain, setDomain] = useState<Domain | null | undefined>();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [note, setNote] = useState<string | undefined>();
  const storeId = ctx?.store.id;
  const allowed = ctx?.can("store.manage") ?? false;

  useEffect(() => {
    if (!storeId || !allowed) return;
    api<{ domain: Domain | null }>(`/api/v1/stores/${storeId}/domain`)
      .then((r) => setDomain(r.domain))
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [storeId, allowed]);

  if (!ctx) return null;
  if (!allowed) {
    return (
      <EmptyState icon={<GlobeIcon size={26} />} title="Only owners manage the store's domain">
        Ask a store owner to connect a domain.
      </EmptyState>
    );
  }

  async function run(action: "save" | "verify" | "remove") {
    setBusy(action);
    setError(undefined);
    setNote(undefined);
    try {
      const path = `/api/v1/stores/${ctx!.store.id}/domain${action === "verify" ? "/verify" : ""}`;
      const r = await api<{ domain: Domain | null }>(path, action === "save" ? { method: "PUT", body: { domain: input } } : { method: action === "verify" ? "POST" : "DELETE" });
      setDomain(r.domain);
      if (action === "verify") setNote("Verified. Your shop is live on this domain once DNS reaches everyone, usually within minutes.");
    } catch (err) {
      setError(err instanceof ApiError && err.problem.errors?.[0] ? err.problem.errors[0].message : errorMessage(err));
    }
    setBusy(undefined);
  }

  const platform = storefrontUrl(ctx.store.slug).replace(/^https?:\/\//, "");
  if (domain === undefined) return <div className="c-skeleton" role="status" aria-label="Loading domain" style={{ height: 120 }} />;
  return (
    <div style={{ display: "grid", gap: 20 }}>
      <Card title="Your shop's address">
        <p style={{ marginTop: 0 }}>
          Your shop is always at <a href={storefrontUrl(ctx.store.slug)}>{platform}</a>. Connect a domain you own, such as shop.yourbrand.com, to use that instead.
        </p>
        {!domain ? (
          <form
            className="c-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run("save");
            }}
          >
            <div className="c-field">
              <label className="c-label" htmlFor={`${id}-d`}>
                Domain
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <input id={`${id}-d`} className="c-input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="shop.yourbrand.com" autoCapitalize="none" spellCheck={false} />
                <button type="submit" className="c-btn c-btn-primary" disabled={!input.trim() || busy !== undefined}>
                  {busy === "save" ? "Saving…" : "Connect"}
                </button>
              </div>
            </div>
          </form>
        ) : (
          <div className="c-form">
            <p style={{ margin: 0, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <strong style={{ fontSize: 17 }}>{domain.domain}</strong>
              <Badge tone={domain.status === "verified" ? "success" : "warning"}>{domain.status === "verified" ? "Connected" : "Waiting for DNS"}</Badge>
              {domain.status === "verified" && (
                <a href={`https://${domain.domain}`} target="_blank" rel="noreferrer">
                  Visit
                </a>
              )}
            </p>
            {domain.status === "pending" && (
              <>
                <p style={{ margin: 0 }}>Add these two records where you bought the domain (GoDaddy, Namecheap, Cloudflare…), then press Verify.</p>
                <div className="c-dns">
                  <p className="c-hint" style={{ margin: 0 }}>
                    1. Point the domain at your shop
                  </p>
                  <Copyable label="Type" value="CNAME" />
                  <Copyable label="Name" value={domain.domain} />
                  <Copyable label="Value" value={domain.cname} />
                  <p className="c-hint" style={{ margin: "8px 0 0" }}>
                    2. Prove it&apos;s yours
                  </p>
                  <Copyable label="Type" value="TXT" />
                  <Copyable label="Name" value={domain.txt.name} />
                  <Copyable label="Value" value={domain.txt.value} />
                </div>
              </>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              {domain.status === "pending" && (
                <button type="button" className="c-btn c-btn-primary" disabled={busy !== undefined} onClick={() => void run("verify")}>
                  {busy === "verify" ? "Checking DNS…" : "Verify"}
                </button>
              )}
              <button type="button" className="c-btn c-btn-ghost" disabled={busy !== undefined} onClick={() => void run("remove")}>
                Disconnect
              </button>
            </div>
            {domain.checkedAt && domain.status === "pending" && (
              <p className="c-hint" style={{ margin: 0 }}>
                Last checked {new Date(domain.checkedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.
              </p>
            )}
          </div>
        )}
        {note && (
          <p role="status" className="c-hint">
            {note}
          </p>
        )}
        {error && (
          <p role="alert" className="c-error" style={{ marginBottom: 0 }}>
            {error}
          </p>
        )}
      </Card>
      <p className="c-hint" style={{ margin: 0 }}>
        Secure https certificates are issued automatically once the domain is verified.
      </p>
    </div>
  );
}
