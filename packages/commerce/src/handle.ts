/**
 * Handles are the URL names of products and collections inside a store
 * (/s/<store>/p/<handle>): lowercase letters, digits and single hyphens.
 */
export const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,98}[a-z0-9]?$/;

export function isHandle(value: string): boolean {
  return value.length >= 1 && value.length <= 100 && HANDLE_PATTERN.test(value);
}

/** A handle from a title: "Chai & Co Masala (250g)" → "chai-and-co-masala-250g". */
export function handleize(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/, "");
}

/** The first of `base`, `base-2`, `base-3`… not in `taken`. */
export function uniqueHandle(base: string, taken: ReadonlySet<string>): string {
  const root = base || "item";
  if (!taken.has(root)) return root;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${root.slice(0, 100 - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}
