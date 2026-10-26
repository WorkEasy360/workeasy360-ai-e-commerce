import { BrandMark } from "@workeasy/ui/react";

export default function NotFound() {
  return (
    <main className="sf-center">
      <div>
        <BrandMark size={56} />
        <h1>We couldn&apos;t find that store</h1>
        <p>The address may be mistyped, or the store may have moved. Check the link the seller shared with you.</p>
      </div>
    </main>
  );
}
