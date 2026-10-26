import { handleize, isHandle, MAX_PAGE_BODY } from "@workeasy/commerce";
import { z } from "zod";

/** Request schema for content pages (Store Design → Pages). */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => v || null);

export const PageBodySchema = z
  .object({
    title: z.string().trim().min(1, "Give the page a title").max(150),
    handle: z
      .string()
      .trim()
      .toLowerCase()
      .refine((h) => h === "" || (isHandle(h) && h.length <= 100), "Use lowercase letters, numbers and single hyphens")
      .optional(),
    body: z.string().max(MAX_PAGE_BODY, "Pages can be up to 50,000 characters").default(""),
    seoTitle: optionalText(70),
    seoDescription: optionalText(320),
    published: z.boolean().default(false),
  })
  .transform((p) => ({ ...p, handle: p.handle || handleize(p.title) }));
