/**
 * Product options and their variants. A product has up to three options
 * (Size, Colour, Grind…), each with values; every combination of values is a
 * variant with its own price, SKU and stock. A product without options has
 * exactly one variant whose option list is empty.
 */

export const MAX_OPTIONS = 3;
export const MAX_VALUES_PER_OPTION = 50;
export const MAX_VARIANTS = 100;

export interface ProductOption {
  name: string;
  values: string[];
}

/** Every combination of option values, in option order: [["S","Red"],["S","Blue"],["M","Red"]…]. */
export function combinations(options: readonly ProductOption[]): string[][] {
  return options.reduce<string[][]>((acc, option) => acc.flatMap((combo) => option.values.map((value) => [...combo, value])), [[]]);
}

/** A stable key for a variant's option values, for matching. */
export function variantKey(values: readonly string[]): string {
  return JSON.stringify(values.map((v) => v.trim().toLowerCase()));
}

/** "Small / Red", or "Default" for a product without options. */
export function variantTitle(values: readonly string[]): string {
  return values.length === 0 ? "Default" : values.join(" / ");
}

/**
 * Rebuilds the variant list after options change: every combination gets a
 * row, keeping the existing row (id, price, SKU, stock) where the values still
 * match, and copying `template` (usually the first variant's price) into new
 * ones. Order follows the options.
 */
export function syncVariants<V extends { options: string[] }>(options: readonly ProductOption[], existing: readonly V[], template: (values: string[]) => V): V[] {
  const byKey = new Map(existing.map((v) => [variantKey(v.options), v]));
  return combinations(options).map((values) => {
    const kept = byKey.get(variantKey(values));
    return kept ? { ...kept, options: values } : template(values);
  });
}

/** Problems with a set of options, as messages for the editor. Empty when valid. */
export function optionProblems(options: readonly ProductOption[]): string[] {
  const problems: string[] = [];
  if (options.length > MAX_OPTIONS) problems.push(`Use at most ${MAX_OPTIONS} options`);
  const names = new Set<string>();
  for (const option of options) {
    const name = option.name.trim();
    if (!name) problems.push("Every option needs a name");
    else if (names.has(name.toLowerCase())) problems.push(`"${name}" is used twice`);
    names.add(name.toLowerCase());
    if (option.values.length === 0) problems.push(`Add at least one value to ${name || "each option"}`);
    if (option.values.length > MAX_VALUES_PER_OPTION) problems.push(`${name} has more than ${MAX_VALUES_PER_OPTION} values`);
    const values = new Set<string>();
    for (const value of option.values) {
      const v = value.trim().toLowerCase();
      if (!v) problems.push(`${name || "An option"} has an empty value`);
      else if (values.has(v)) problems.push(`${name} has "${value.trim()}" twice`);
      values.add(v);
    }
  }
  const count = options.reduce((n, o) => n * Math.max(1, o.values.length), 1);
  if (count > MAX_VARIANTS) problems.push(`These options make ${count} variants; the limit is ${MAX_VARIANTS}`);
  return problems;
}
