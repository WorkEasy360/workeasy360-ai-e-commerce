import type { Metadata } from "next";
import { ShippingView } from "./shipping-view";

export const metadata: Metadata = { title: "Shipping" };

export default function Page() {
  return <ShippingView />;
}
