import type { Metadata } from "next";
import { ProductEditor } from "../product-editor";

export const metadata: Metadata = { title: "Product" };

export default async function ProductPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  return <ProductEditor key={productId} productId={productId} />;
}
