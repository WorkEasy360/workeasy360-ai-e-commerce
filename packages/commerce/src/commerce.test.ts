import { describe, expect, it } from "vitest";
import { ruleProblems } from "./collection-rules";
import { parseCsv, toCsv } from "./csv";
import { handleize, isHandle, uniqueHandle } from "./handle";
import { formatMoney, minorDigits, parseMoney, toDecimalString } from "./money";
import { parseProductCsv, productsToCsv, type CsvProduct } from "./product-csv";
import { combinations, optionProblems, syncVariants, variantTitle } from "./variants";

describe("money", () => {
  it("knows each currency's minor digits", () => {
    expect(minorDigits("INR")).toBe(2);
    expect(minorDigits("JPY")).toBe(0);
    expect(minorDigits("KWD")).toBe(3);
  });

  it("parses typed amounts into minor units", () => {
    expect(parseMoney("1,299.50", "INR")).toBe(129950);
    expect(parseMoney("₹ 999", "INR")).toBe(99900);
    expect(parseMoney("12.5", "USD")).toBe(1250);
    expect(parseMoney("1500", "JPY")).toBe(1500);
    expect(parseMoney("0", "INR")).toBe(0);
  });

  it("refuses negative, malformed or over-precise amounts", () => {
    for (const bad of ["", "-5", "abc", "1.234", "1.2.3", "12e3"]) expect(parseMoney(bad, "INR")).toBeUndefined();
    expect(parseMoney("1.5", "JPY")).toBeUndefined();
  });

  it("round-trips through decimal strings and formats for people", () => {
    expect(toDecimalString(129950, "INR")).toBe("1299.50");
    expect(toDecimalString(5, "USD")).toBe("0.05");
    expect(toDecimalString(1500, "JPY")).toBe("1500");
    expect(formatMoney(129950, "INR", "en-IN")).toBe("₹1,299.50");
    expect(formatMoney(49900, "INR", "en-IN", { compact: true })).toBe("₹499");
  });
});

describe("handles", () => {
  it("turns titles into URL handles", () => {
    expect(handleize("Chai & Co Masala (250g)")).toBe("chai-and-co-masala-250g");
    expect(handleize("  Café Crème  ")).toBe("cafe-creme");
    expect(isHandle("chai-masala")).toBe(true);
    expect(isHandle("Chai")).toBe(false);
    expect(isHandle("a--b")).toBe(false);
    expect(isHandle("-a")).toBe(false);
  });

  it("finds the next free handle", () => {
    expect(uniqueHandle("tee", new Set())).toBe("tee");
    expect(uniqueHandle("tee", new Set(["tee", "tee-2"]))).toBe("tee-3");
  });
});

describe("variants", () => {
  const size = { name: "Size", values: ["S", "M"] };
  const colour = { name: "Colour", values: ["Red", "Blue"] };

  it("lists every combination of option values", () => {
    expect(combinations([size, colour])).toEqual([["S", "Red"], ["S", "Blue"], ["M", "Red"], ["M", "Blue"]]);
    expect(combinations([])).toEqual([[]]);
    expect(variantTitle(["S", "Red"])).toBe("S / Red");
    expect(variantTitle([])).toBe("Default");
  });

  it("keeps existing variants when options change and fills new ones from the template", () => {
    const existing = [{ id: "a", options: ["S"], price: 100 }, { id: "b", options: ["m"], price: 200 }];
    const next = syncVariants([{ name: "Size", values: ["S", "M", "L"] }], existing, (options) => ({ id: "new", options, price: 100 }));
    expect(next).toEqual([
      { id: "a", options: ["S"], price: 100 },
      { id: "b", options: ["M"], price: 200 },
      { id: "new", options: ["L"], price: 100 },
    ]);
  });

  it("reports option problems", () => {
    expect(optionProblems([size, colour])).toEqual([]);
    expect(optionProblems([{ name: "", values: [] }])).toEqual(["Every option needs a name", "Add at least one value to each option"]);
    expect(optionProblems([size, { name: "size", values: ["S", "s"] }])).toEqual(['"size" is used twice', 'size has "s" twice']);
    const many = Array.from({ length: 11 }, (_, i) => String(i));
    expect(optionProblems([{ name: "A", values: many }, { name: "B", values: many }])).toContain("These options make 121 variants; the limit is 100");
  });
});

describe("collection rules", () => {
  it("accepts valid rules and explains invalid ones", () => {
    expect(ruleProblems({ match: "all", conditions: [{ field: "tag", operator: "equals", value: "summer" }, { field: "price", operator: "less_than", value: "99900" }] })).toEqual([]);
    expect(ruleProblems({ match: "all", conditions: [] })).toEqual(["Add at least one condition"]);
    expect(ruleProblems({ match: "any", conditions: [{ field: "price", operator: "contains", value: "x" }] })).toEqual([
      'Condition 1: "contains" doesn\'t apply to price',
      "Condition 1: enter a price",
    ]);
    expect(ruleProblems({ match: "any", conditions: [{ field: "type", operator: "equals", value: "gadget" }] })).toEqual(["Condition 1: choose a product type"]);
  });
});

describe("csv", () => {
  it("parses quoted fields, doubled quotes, CRLF and a byte-order mark", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n\nlast,"multi\nline"')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["last", "multi\nline"],
    ]);
  });

  it("writes CSV that parses back, guarding against formula injection", () => {
    const text = toCsv([["a", "b,c", 'q"q', "=SUM(A1)", "-5", null]]);
    expect(text).toBe('a,"b,c","q""q",\'=SUM(A1),-5,\r\n');
    expect(parseCsv(text)).toEqual([["a", "b,c", 'q"q', "'=SUM(A1)", "-5", ""]]);
  });
});

describe("product CSV", () => {
  const tee: CsvProduct = {
    handle: "cotton-tee",
    title: "Cotton Tee",
    type: "physical",
    status: "active",
    description: "Soft, \"breathable\" cotton.\nMachine wash.",
    vendor: "Acme",
    tags: ["summer", "basics"],
    options: [{ name: "Size", values: ["S", "M"] }],
    seoTitle: null,
    seoDescription: null,
    variants: [
      { options: ["S"], sku: "TEE-S", barcode: null, priceMinor: 49900, compareAtMinor: 69900, costMinor: null, weightGrams: 180, stock: 12, trackInventory: true },
      { options: ["M"], sku: "TEE-M", barcode: null, priceMinor: 49900, compareAtMinor: null, costMinor: 20000, weightGrams: 190, stock: 0, trackInventory: true },
    ],
  };
  const ebook: CsvProduct = {
    handle: "brew-guide",
    title: "=Brew guide",
    type: "digital",
    status: "draft",
    description: "",
    vendor: null,
    tags: [],
    options: [],
    seoTitle: "Brew guide PDF",
    seoDescription: null,
    variants: [{ options: [], sku: null, barcode: null, priceMinor: 19900, compareAtMinor: null, costMinor: null, weightGrams: null, stock: null, trackInventory: false }],
  };

  it("round-trips an export through import unchanged", () => {
    const csv = productsToCsv([tee, ebook], "INR");
    expect(parseProductCsv(csv, "INR")).toEqual({ products: [tee, ebook], problems: [] });
  });

  it("applies defaults and reads product fields from the first row only", () => {
    const csv = "Handle,Title,Price,Option1 Name,Option1 Value\nmug,Mug,299,Colour,White\nmug,,349,,Black\n";
    const { products, problems } = parseProductCsv(csv, "INR");
    expect(problems).toEqual([]);
    expect(products[0]).toMatchObject({ title: "Mug", type: "physical", status: "draft", options: [{ name: "Colour", values: ["White", "Black"] }] });
    expect(products[0]!.variants.map((v) => [v.options, v.priceMinor, v.stock, v.trackInventory])).toEqual([
      [["White"], 29900, null, true],
      [["Black"], 34900, null, true],
    ]);
  });

  it("reports problems by row and leaves bad products out", () => {
    const csv = [
      "Handle,Title,Type,Price,Stock,Option1 Name,Option1 Value",
      "good,Good,,100,,,",
      "Bad Handle,Bad,,100,,,",
      "pricey,Pricey,gadget,abc,1.5,,",
      "dup,Dup,,100,,Size,S",
      "dup,,,100,,,S",
      ",No handle,,100,,,",
    ].join("\n");
    const { products, problems } = parseProductCsv(csv, "INR");
    expect(products.map((p) => p.handle)).toEqual(["good"]);
    expect(problems).toEqual([
      { row: 3, message: '"bad handle" is not a valid handle: use lowercase letters, numbers and hyphens' },
      { row: 4, message: "Type must be one of physical, digital, service" },
      { row: 4, message: "Price must be an amount such as 499 or 499.50" },
      { row: 4, message: "Stock must be a whole number" },
      { row: 6, message: "The variant S appears twice" },
      { row: 7, message: "Handle is empty" },
    ]);
  });

  it("requires the key columns", () => {
    expect(parseProductCsv("Name,Cost\nx,1\n", "INR").problems).toEqual([
      { row: 1, message: 'Missing the "Handle" column' },
      { row: 1, message: 'Missing the "Title" column' },
      { row: 1, message: 'Missing the "Price" column' },
    ]);
  });
});
