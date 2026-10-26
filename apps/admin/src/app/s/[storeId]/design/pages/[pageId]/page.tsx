import type { Metadata } from "next";
import { PageEditor } from "./page-editor";

export const metadata: Metadata = { title: "Edit page" };

export default async function Page({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params;
  return <PageEditor pageId={pageId} />;
}
