import type { Metadata } from "next";
import { CollectionEditor } from "../collection-editor";

export const metadata: Metadata = { title: "Collection" };

export default async function CollectionPage({ params }: { params: Promise<{ collectionId: string }> }) {
  const { collectionId } = await params;
  return <CollectionEditor key={collectionId} collectionId={collectionId} />;
}
