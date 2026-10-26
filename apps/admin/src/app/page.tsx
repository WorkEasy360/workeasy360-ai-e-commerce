import { BrandMark } from "@workeasy/ui/react";
import { SessionPanel } from "./session-panel";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { signin, returnTo, new: createNew } = await searchParams;
  // Only invitation links may be returned to after signing in.
  const safeReturnTo = typeof returnTo === "string" && /^\/invite\/[A-Za-z0-9_-]{20,200}$/.test(returnTo) ? returnTo : undefined;
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
        <SessionPanel signInFailed={signin === "failed"} createNew={createNew === "1"} {...(safeReturnTo ? { returnTo: safeReturnTo } : {})} />
      </div>
    </main>
  );
}
