import type { Metadata } from "next";
import { DesignView } from "./design-view";

export const metadata: Metadata = { title: "Store Design" };

export default function Page() {
  return <DesignView />;
}
