import type { Metadata } from "next";
import { CollectionEditor } from "../collection-editor";

export const metadata: Metadata = { title: "Create collection" };

export default function NewCollectionPage() {
  return <CollectionEditor />;
}
