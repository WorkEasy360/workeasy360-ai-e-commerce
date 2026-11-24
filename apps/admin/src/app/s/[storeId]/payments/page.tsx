import type { Metadata } from "next";
import { PaymentsView } from "./payments-view";

export const metadata: Metadata = { title: "Payments & tax" };

export default function Page() {
  return <PaymentsView />;
}
