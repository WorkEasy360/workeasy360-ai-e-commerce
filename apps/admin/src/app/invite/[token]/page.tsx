import type { Metadata } from "next";
import { BrandMark } from "@workeasy/ui/react";
import { AcceptInvitation } from "./accept";

export const metadata: Metadata = { title: "Join a store", robots: { index: false, follow: false }, referrer: "no-referrer" };

/** Where an invitation link lands: say which store and role, then join (signing in first if needed). */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main className="c-center-page">
      <div className="c-auth">
        <div className="c-auth-brand">
          <BrandMark size={44} />
          <span>
            <strong>Workeasy360</strong>
            <small>AI Commerce</small>
          </span>
        </div>
        <AcceptInvitation token={token} />
      </div>
    </main>
  );
}
