import { BrandMark } from "@workeasy/ui/react";

/** The bare storefront origin has no shop of its own; shops live at /s/<address>. */
export default function StorefrontHome() {
  return (
    <main className="sf-center">
      <div>
        <BrandMark size={64} />
        <h1>Workeasy360 storefronts</h1>
        <p>Each shop has its own address. Check the link the seller shared with you.</p>
      </div>
    </main>
  );
}
