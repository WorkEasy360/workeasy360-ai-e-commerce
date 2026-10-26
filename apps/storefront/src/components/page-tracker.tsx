"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { track } from "../lib/track";

/** Counts each page a shopper opens, for the shop's analytics. */
export function PageTracker({ slug }: { slug: string }) {
  const path = usePathname();
  useEffect(() => {
    track(slug, { type: "page_view", path });
  }, [slug, path]);
  return null;
}
