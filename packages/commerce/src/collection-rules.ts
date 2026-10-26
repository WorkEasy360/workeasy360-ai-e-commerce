/**
 * Rules for automated collections: products join when they match all (or
 * any) of the conditions, and leave when they stop matching. The API turns
 * rules into SQL; this module describes and validates them.
 */

export const RULE_FIELDS = ["tag", "type", "vendor", "title", "price"] as const;
export type RuleField = (typeof RULE_FIELDS)[number];

export const RULE_OPERATORS: Record<RuleField, readonly RuleOperator[]> = {
  tag: ["equals", "not_equals"],
  type: ["equals", "not_equals"],
  vendor: ["equals", "not_equals"],
  title: ["contains", "not_contains", "starts_with"],
  // Compared with the product's lowest variant price, in minor units.
  price: ["greater_than", "less_than"],
};

export type RuleOperator = "equals" | "not_equals" | "contains" | "not_contains" | "starts_with" | "greater_than" | "less_than";

export interface RuleCondition {
  field: RuleField;
  operator: RuleOperator;
  /** Text for tag, type, vendor and title; minor units (as a decimal string) for price. */
  value: string;
}

export interface CollectionRules {
  match: "all" | "any";
  conditions: RuleCondition[];
}

export const MAX_CONDITIONS = 10;

export const RULE_FIELD_LABELS: Record<RuleField, string> = {
  tag: "Product tag",
  type: "Product type",
  vendor: "Brand / vendor",
  title: "Product title",
  price: "Price",
};

export const RULE_OPERATOR_LABELS: Record<RuleOperator, string> = {
  equals: "is",
  not_equals: "is not",
  contains: "contains",
  not_contains: "does not contain",
  starts_with: "starts with",
  greater_than: "is greater than",
  less_than: "is less than",
};

export function ruleProblems(rules: CollectionRules): string[] {
  const problems: string[] = [];
  if (rules.conditions.length === 0) problems.push("Add at least one condition");
  if (rules.conditions.length > MAX_CONDITIONS) problems.push(`Use at most ${MAX_CONDITIONS} conditions`);
  rules.conditions.forEach((c, i) => {
    const n = i + 1;
    if (!RULE_FIELDS.includes(c.field)) problems.push(`Condition ${n}: unknown field`);
    else if (!RULE_OPERATORS[c.field].includes(c.operator)) problems.push(`Condition ${n}: "${RULE_OPERATOR_LABELS[c.operator] ?? c.operator}" doesn't apply to ${RULE_FIELD_LABELS[c.field].toLowerCase()}`);
    const value = c.value.trim();
    if (!value) problems.push(`Condition ${n}: enter a value`);
    else if (c.field === "price" && !/^\d{1,15}$/.test(value)) problems.push(`Condition ${n}: enter a price`);
    else if (c.field === "type" && !["physical", "digital", "service"].includes(value)) problems.push(`Condition ${n}: choose a product type`);
    else if (value.length > 200) problems.push(`Condition ${n}: the value is too long`);
  });
  return problems;
}
