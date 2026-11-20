import type { Metadata } from "next";
import { ShippingView } from "./shipping-view";

export const metadata: Metadata = { title: "Delivery & pickup" };

export default function Page() {
  return <ShippingView />;
}
