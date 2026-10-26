import type { Metadata } from "next";
import { PaymentsView } from "./payments-view";

export const metadata: Metadata = { title: "Payments & Finances" };

export default function Page() {
  return <PaymentsView />;
}
