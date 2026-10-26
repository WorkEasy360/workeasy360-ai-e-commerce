/**
 * Browser-side calls to the API through the admin's same-origin /api proxy.
 * The session cookie is HttpOnly and sent automatically; browsers add the
 * Origin header the API requires on mutations.
 */

export interface Problem {
  status: number;
  code: string;
  title: string;
  requestId?: string;
  errors?: Array<{ field: string; code: string; message: string }>;
}

export class ApiError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.title);
    this.name = "ApiError";
  }
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch {
    throw new ApiError({ status: 0, code: "NETWORK", title: "We couldn't reach Workeasy360. Check your connection and try again." });
  }
  if (res.ok) return (await res.json()) as T;
  let problem: Problem = { status: res.status, code: "UNKNOWN", title: "Something went wrong." };
  try {
    problem = { ...problem, ...((await res.json()) as Partial<Problem>) };
  } catch {
    // Non-JSON error body; keep the generic problem.
  }
  // Server faults carry a reference support can look up in the logs.
  if (problem.status >= 500 && problem.requestId) problem = { ...problem, title: `${problem.title} (reference ${problem.requestId})` };
  throw new ApiError(problem);
}

/** The first field message, or the problem title, for showing under a form. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.problem.errors?.[0]?.message ?? err.problem.title;
  return "Something went wrong.";
}

export type StoreRole = "owner" | "admin" | "staff" | "fulfillment" | "analyst";

export interface StoreSummary {
  id: string;
  name: string;
  slug: string;
  role: StoreRole;
  permissions: string[];
}

export interface Me {
  user: { id: string; displayName: string | null };
  stores: StoreSummary[];
}

export interface Store {
  id: string;
  slug: string;
  name: string;
  status: "active" | "suspended";
  currency: string;
  country: string;
  defaultLocale: string;
  timezone: string;
  contactEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoreResponse {
  store: Store;
  role: StoreRole;
  permissions: string[];
}

export const STOREFRONT_URL = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? "http://localhost:3001";

export function storefrontUrl(slug: string): string {
  return `${STOREFRONT_URL}/s/${slug}`;
}
