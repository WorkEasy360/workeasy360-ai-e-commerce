import type { Metadata } from "next";
import { PagesView } from "./pages-view";

export const metadata: Metadata = { title: "Pages" };

export default function Page() {
  return <PagesView />;
}
