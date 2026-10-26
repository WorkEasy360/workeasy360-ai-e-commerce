"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Badge, Card, CopyIcon, EmptyState, PlusIcon, UsersIcon } from "@workeasy/ui/react";
import { Dialog } from "@workeasy/ui/client";
import { api, ApiError, errorMessage, type StoreRole } from "../../../../../lib/api";
import { useStore } from "../../store-shell";

interface Member {
  userId: string;
  displayName: string | null;
  role: StoreRole;
  status: "active" | "revoked";
  joinedAt: string;
}

interface Invitation {
  id: string;
  email: string | null;
  role: StoreRole;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "accepted" | "revoked" | "expired";
}

const ROLES: StoreRole[] = ["owner", "admin", "staff", "fulfillment", "analyst"];
const RANK: Record<StoreRole, number> = { owner: 4, admin: 3, staff: 2, fulfillment: 1, analyst: 1 };
const ROLE_NAME: Record<StoreRole, string> = { owner: "Owner", admin: "Admin", staff: "Staff", fulfillment: "Fulfilment", analyst: "Analyst" };
const ROLE_HELP: Record<StoreRole, string> = {
  owner: "Everything, including the store address, domain and plan",
  admin: "Everything except the store address, domain and plan",
  staff: "Products, orders, offers, reviews, design and AI",
  fulfillment: "Orders and stock",
  analyst: "Read-only reports",
};
const INVITE_STATUS = { pending: { label: "Waiting", tone: "warning" }, accepted: { label: "Joined", tone: "success" }, revoked: { label: "Cancelled", tone: "neutral" }, expired: { label: "Expired", tone: "neutral" } } as const;

function InviteDialog({ storeId, myRole, onDone, onClose }: { storeId: string; myRole: StoreRole; onDone: () => void; onClose: () => void }) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StoreRole>("staff");
  const [url, setUrl] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function create() {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api<{ url: string }>(`/api/v1/stores/${storeId}/invitations`, { method: "POST", body: { email: email || null, role } });
      setUrl(r.url);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError && err.problem.errors?.[0] ? err.problem.errors[0].message : errorMessage(err));
    }
    setBusy(false);
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={url ? "Invitation ready" : "Invite someone"}
      footer={
        url ? (
          <button type="button" className="c-btn c-btn-primary" onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button type="button" className="c-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="c-btn c-btn-primary" disabled={busy} onClick={() => void create()}>
              {busy ? "Creating…" : "Create invitation"}
            </button>
          </>
        )
      }
    >
      {url ? (
        <div className="c-form">
          <p style={{ margin: 0 }}>{email ? `We've emailed this link to ${email}. You can also share it yourself:` : "Share this link with the person you're inviting:"}</p>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="c-input" readOnly value={url} aria-label="Invitation link" onFocus={(e) => e.target.select()} />
            <button type="button" className="c-btn" onClick={() => void navigator.clipboard.writeText(url).then(() => setCopied(true))}>
              <CopyIcon size={14} /> {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="c-hint" style={{ margin: 0 }}>
            It works once and expires in 7 days. For security it isn&apos;t shown again; create a new one if it&apos;s lost.
          </p>
        </div>
      ) : (
        <div className="c-form">
          <div className="c-field">
            <label className="c-label" htmlFor={`${id}-email`}>
              Email <small>(optional: we&apos;ll send them the link)</small>
            </label>
            <input id={`${id}-email`} className="c-input" type="email" autoComplete="off" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} placeholder="ravi@example.com" />
          </div>
          <div className="c-radio-row">
            {ROLES.filter((r) => RANK[r] <= RANK[myRole]).map((r) => (
              <label key={r} className="c-radio-card">
                <input type="radio" className="c-check-input" name={`${id}-role`} checked={role === r} onChange={() => setRole(r)} />
                <span>
                  <strong>{ROLE_NAME[r]}</strong>
                  <span>{ROLE_HELP[r]}</span>
                </span>
              </label>
            ))}
          </div>
          {error && (
            <p role="alert" className="c-error" style={{ margin: 0 }}>
              {error}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}

/** The people who can sign in to this store, what their role lets them do, and invitations to join. */
export default function StaffPage() {
  const ctx = useStore();
  const [members, setMembers] = useState<Member[] | undefined>();
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<Member | undefined>();
  const [error, setError] = useState<string | undefined>();
  const storeId = ctx?.store.id;
  const allowed = ctx?.can("members.manage") ?? false;

  const load = useCallback(() => {
    if (!storeId || !allowed) return;
    api<{ members: Member[] }>(`/api/v1/stores/${storeId}/members`)
      .then((r) => setMembers(r.members))
      .catch((err: unknown) => setError(errorMessage(err)));
    api<{ items: Invitation[] }>(`/api/v1/stores/${storeId}/invitations`)
      .then((r) => setInvitations(r.items))
      .catch(() => undefined);
  }, [storeId, allowed]);

  useEffect(() => {
    load();
  }, [load]);

  if (!ctx) return null;
  if (!allowed) {
    return (
      <EmptyState icon={<UsersIcon size={26} />} title="Only owners and admins manage staff">
        Ask one of them to invite people or change roles.
      </EmptyState>
    );
  }
  const myRole = ctx.role;
  const canManage = (m: Member) => RANK[m.role] <= RANK[myRole];

  async function change(m: Member, body: { role?: StoreRole; status?: "active" | "revoked" }) {
    setError(undefined);
    try {
      await api(`/api/v1/stores/${ctx!.store.id}/members/${m.userId}`, { method: "PATCH", body });
      setRemoving(undefined);
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function revoke(i: Invitation) {
    try {
      await api(`/api/v1/stores/${ctx!.store.id}/invitations/${i.id}/revoke`, { method: "POST" });
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const open = invitations.filter((i) => i.status === "pending");
  return (
    <div style={{ display: "grid", gap: 20 }}>
      {error && (
        <p role="alert" className="c-error" style={{ margin: 0 }}>
          {error}
        </p>
      )}
      <Card
        title="Staff"
        actions={
          <button type="button" className="c-btn c-btn-primary c-btn-sm" onClick={() => setInviting(true)}>
            <PlusIcon size={14} /> Invite someone
          </button>
        }
        flush
      >
        <div className="c-table-wrap">
          <table className="c-table c-table-stack">
            <caption className="c-visually-hidden">Staff</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">Joined</th>
                <th scope="col">
                  <span className="c-visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {members === undefined ? (
                <tr>
                  <td colSpan={5}>
                    <div className="c-skeleton" role="status" aria-label="Loading staff" />
                  </td>
                </tr>
              ) : (
                members.map((m) => {
                  const self = m.userId === ctx.userId;
                  const editable = canManage(m) && !self && m.status === "active";
                  return (
                    <tr key={m.userId}>
                      <td data-label="Name">
                        <span className="c-cell-title">{m.displayName ?? "Unnamed account"}</span>
                        {self && <span className="c-cell-sub">You</span>}
                      </td>
                      <td data-label="Role">
                        {editable ? (
                          <select className="c-select" aria-label={`Role for ${m.displayName ?? "this person"}`} value={m.role} onChange={(e) => void change(m, { role: e.target.value as StoreRole })}>
                            {ROLES.filter((r) => RANK[r] <= RANK[myRole]).map((r) => (
                              <option key={r} value={r}>
                                {ROLE_NAME[r]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span style={{ fontWeight: 600 }}>{ROLE_NAME[m.role]}</span>
                        )}
                        <span className="c-cell-sub">{ROLE_HELP[m.role]}</span>
                      </td>
                      <td data-label="Status">
                        <Badge tone={m.status === "active" ? "success" : "neutral"}>{m.status === "active" ? "Active" : "Removed"}</Badge>
                      </td>
                      <td data-label="Joined">{new Date(m.joinedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}</td>
                      <td data-label="Actions" className="c-num">
                        {editable && (
                          <button type="button" className="c-btn c-btn-sm c-btn-ghost" onClick={() => setRemoving(m)}>
                            Remove
                          </button>
                        )}
                        {canManage(m) && !self && m.status === "revoked" && (
                          <button type="button" className="c-btn c-btn-sm" onClick={() => void change(m, { status: "active" })}>
                            Restore
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {invitations.length > 0 && (
        <Card title={`Invitations${open.length ? ` (${open.length} waiting)` : ""}`} flush>
          <div className="c-table-wrap">
            <table className="c-table c-table-stack">
              <caption className="c-visually-hidden">Invitations</caption>
              <thead>
                <tr>
                  <th scope="col">Sent to</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">Expires</th>
                  <th scope="col">
                    <span className="c-visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {invitations.slice(0, 20).map((i) => (
                  <tr key={i.id}>
                    <td data-label="Sent to">{i.email ?? <span className="c-muted">Shared link</span>}</td>
                    <td data-label="Role">{ROLE_NAME[i.role]}</td>
                    <td data-label="Status">
                      <Badge tone={INVITE_STATUS[i.status].tone}>{INVITE_STATUS[i.status].label}</Badge>
                    </td>
                    <td data-label="Expires">{new Date(i.expiresAt).toLocaleDateString(undefined, { dateStyle: "medium" })}</td>
                    <td data-label="Actions" className="c-num">
                      {i.status === "pending" && (
                        <button type="button" className="c-btn c-btn-sm c-btn-ghost" onClick={() => void revoke(i)}>
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {inviting && <InviteDialog storeId={ctx.store.id} myRole={myRole} onDone={load} onClose={() => setInviting(false)} />}
      {removing && (
        <Dialog
          open
          onClose={() => setRemoving(undefined)}
          title={`Remove ${removing.displayName ?? "this person"}?`}
          footer={
            <>
              <button type="button" className="c-btn" onClick={() => setRemoving(undefined)}>
                Keep
              </button>
              <button type="button" className="c-btn c-btn-danger" onClick={() => void change(removing, { status: "revoked" })}>
                Remove
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>They lose access to this store straight away. Their past actions stay in the audit log, and you can restore them later.</p>
        </Dialog>
      )}
    </div>
  );
}
