import { defaultTheme, themeProblems, type Theme } from "@workeasy/commerce";
import { sql, type Transaction } from "kysely";
import type { Database } from "../schema.js";

/**
 * Store Design: the theme being edited (draft) and the one shoppers see
 * (published). A store that never opened the editor uses the default theme.
 */
type Trx = Transaction<Database>;

export interface ThemeState {
  draft: Theme;
  published: Theme | null;
  publishedAt: Date | null;
  updatedAt: Date | null;
  /** The draft differs from what's live. */
  unpublished: boolean;
}

/** A stored theme, or the default when it's missing or no longer valid. */
function parse(value: unknown, fallbackLanguage: string): Theme {
  return value && themeProblems(value).length === 0 ? (value as Theme) : defaultTheme(fallbackLanguage);
}

export async function getThemeState(trx: Trx, defaultLanguage: string): Promise<ThemeState> {
  const r = await trx.selectFrom("store_themes").selectAll().executeTakeFirst();
  if (!r) {
    const draft = defaultTheme(defaultLanguage);
    return { draft, published: null, publishedAt: null, updatedAt: null, unpublished: false };
  }
  const draft = parse(r.draft, defaultLanguage);
  const published = r.published ? parse(r.published, defaultLanguage) : null;
  return { draft, published, publishedAt: r.published_at, updatedAt: r.updated_at, unpublished: JSON.stringify(draft) !== JSON.stringify(published ?? defaultTheme(defaultLanguage)) };
}

export async function saveDraft(trx: Trx, storeId: string, draft: Theme, userId: string): Promise<void> {
  await trx
    .insertInto("store_themes")
    .values({ store_id: storeId, draft: draft as unknown as Record<string, unknown>, updated_by: userId })
    .onConflict((oc) => oc.column("store_id").doUpdateSet({ draft: draft as unknown as Record<string, unknown>, updated_by: userId }))
    .execute();
}

/** Makes the draft live. */
export async function publish(trx: Trx, storeId: string, userId: string, defaultLanguage: string): Promise<void> {
  const state = await getThemeState(trx, defaultLanguage);
  await trx
    .insertInto("store_themes")
    .values({ store_id: storeId, draft: state.draft as unknown as Record<string, unknown>, published: state.draft as unknown as Record<string, unknown>, published_at: new Date(), updated_by: userId })
    .onConflict((oc) => oc.column("store_id").doUpdateSet({ published: sql`excluded.draft`, published_at: sql`now()`, updated_by: userId }))
    .execute();
}

/** Throws the draft away, back to what's live. */
export async function discardDraft(trx: Trx, defaultLanguage: string): Promise<void> {
  const state = await getThemeState(trx, defaultLanguage);
  const back = state.published ?? defaultTheme(defaultLanguage);
  await trx.updateTable("store_themes").set({ draft: back as unknown as Record<string, unknown> }).execute();
}

/** What shoppers see; readable by the public role (published column only). */
export async function publishedTheme(trx: Trx, defaultLanguage: string): Promise<Theme> {
  const r = await trx.selectFrom("store_themes").select("published").executeTakeFirst();
  return r?.published ? parse(r.published, defaultLanguage) : defaultTheme(defaultLanguage);
}
