import type { Metadata } from "next";
import { Suspense } from "react";
import { AiView } from "./ai-view";

export const metadata: Metadata = { title: "AI Studio" };

export default function Page() {
  return (
    <Suspense>
      <AiView />
    </Suspense>
  );
}
