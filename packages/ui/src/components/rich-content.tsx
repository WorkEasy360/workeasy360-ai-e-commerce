import type { ReactNode } from "react";

/**
 * Renders a content page's blocks (from parseContent in @workeasy/commerce)
 * as plain elements: text is never treated as HTML. The block shapes are
 * repeated here so this package stays free of commerce code.
 */
export type RichInline = { type: "text" | "strong" | "em"; text: string } | { type: "link"; text: string; href: string };
export type RichBlock =
  | { type: "heading"; level: 2 | 3; text: RichInline[] }
  | { type: "paragraph"; text: RichInline[] }
  | { type: "quote"; text: RichInline[] }
  | { type: "list"; ordered: boolean; items: RichInline[][] };

function inlines(parts: readonly RichInline[], href: (h: string) => string): ReactNode {
  return parts.map((p, i) => {
    if (p.type === "strong") return <strong key={i}>{p.text}</strong>;
    if (p.type === "em") return <em key={i}>{p.text}</em>;
    if (p.type === "link") {
      const external = p.href.startsWith("https://");
      return (
        <a key={i} href={href(p.href)} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
          {p.text}
        </a>
      );
    }
    return p.text;
  });
}

/** `resolveHref` turns store paths ("/products") into real links, such as "/s/chai-co/products". */
export function RichContent({ blocks, resolveHref = (h) => h, className = "c-rich" }: { blocks: readonly RichBlock[]; resolveHref?: (href: string) => string; className?: string }) {
  return (
    <div className={className}>
      {blocks.map((b, i) => {
        switch (b.type) {
          case "heading":
            return b.level === 2 ? <h2 key={i}>{inlines(b.text, resolveHref)}</h2> : <h3 key={i}>{inlines(b.text, resolveHref)}</h3>;
          case "paragraph":
            return <p key={i}>{inlines(b.text, resolveHref)}</p>;
          case "quote":
            return <blockquote key={i}>{inlines(b.text, resolveHref)}</blockquote>;
          case "list": {
            const items = b.items.map((item, n) => <li key={n}>{inlines(item, resolveHref)}</li>);
            return b.ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
          }
        }
      })}
    </div>
  );
}
