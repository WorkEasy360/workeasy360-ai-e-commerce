import type { ReactNode } from "react";
import { StoreShell } from "./store-shell";

export default async function StoreLayout({ params, children }: { params: Promise<{ storeId: string }>; children: ReactNode }) {
  const { storeId } = await params;
  return <StoreShell storeId={storeId}>{children}</StoreShell>;
}
