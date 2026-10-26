// Liveness for the container platform. It does not call the API: an app
// that can render pages is healthy even while the API is restarting.
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
}
