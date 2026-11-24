import { OrderIcon, PaymentIcon, ProductIcon, ShareIcon, StoreIcon, Wordmark } from "@workeasy/ui/react";
import { SessionPanel } from "./session-panel";

const FEATURES = [
  { icon: <StoreIcon />, title: "Store Builder", text: "Customize and publish your storefront." },
  { icon: <ProductIcon />, title: "Products & Inventory", text: "Manage catalog, variants and stock." },
  { icon: <PaymentIcon />, title: "Orders & Payments", text: "Track orders, COD and online collections." },
  { icon: <ShareIcon />, title: "Share & Grow", text: "Share store links, QR codes and offers." },
];

/**
 * Sign-in, sign-up and the store list, beside the WorkEasy Commerce brand
 * panel, as in the Commerce designs. On phones the brand panel shrinks to a
 * header above the form.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { signin, returnTo, new: createNew, sso_error: ssoError, reason } = await searchParams;
  // Only invitation links may be returned to after signing in.
  const safeReturnTo = typeof returnTo === "string" && /^\/invite\/[A-Za-z0-9_-]{20,200}$/.test(returnTo) ? returnTo : undefined;
  return (
    <main className="c-auth-split">
      <section className="c-auth-hero" aria-label="WorkEasy Commerce">
        <Wordmark size={40} />
        <span className="c-brand-badge">
          <StoreIcon size={22} /> Commerce
        </span>
        <h1>
          WorkEasy <em>Commerce</em>
        </h1>
        <p className="c-auth-lead">Build Your Online Store. Start Selling Easily.</p>
        <span className="c-auth-rule" aria-hidden="true" />
        <p>Create a branded store, add products, share your store link or QR code, and manage orders in one place.</p>
        <ul className="c-auth-features">
          {FEATURES.map((f) => (
            <li key={f.title}>
              <span aria-hidden="true">{f.icon}</span>
              <span>
                <strong>{f.title}</strong>
                <small>{f.text}</small>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <div className="c-auth-panel">
        <div className="c-auth">
          <SessionPanel
            signInFailed={signin === "failed"}
            createNew={createNew === "1"}
            {...(safeReturnTo ? { returnTo: safeReturnTo } : {})}
            {...(typeof ssoError === "string" && /^[a-z_]{1,40}$/.test(ssoError) ? { ssoError } : {})}
            {...(typeof reason === "string" && /^[a-z_]{1,40}$/.test(reason) ? { reason } : {})}
          />
          <div className="c-auth-tiles" aria-hidden="true">
            <div>
              <StoreIcon /> Create Store
            </div>
            <div>
              <OrderIcon /> Manage Orders
            </div>
            <div>
              <ShareIcon /> Grow Sales
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
