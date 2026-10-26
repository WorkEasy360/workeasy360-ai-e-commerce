/**
 * Database roles (docs/02-data-model.md). The owner role runs migrations and
 * owns every object; runtime roles never own tables and are created without
 * SUPERUSER or BYPASSRLS, so row-level security always applies to them.
 * Migrations grant privileges to these exact names.
 */
// Role names are global to a PostgreSQL cluster, so they carry this app's own
// prefix: other Workeasy360 apps on the same Aurora cluster use their own.
export const DB_ROLES = {
  owner: "wec_owner",
  api: "wec_api",
  worker: "wec_worker",
  public: "wec_public",
} as const;

export type DbRoleKey = keyof typeof DB_ROLES;

export const RUNTIME_ROLE_KEYS = ["api", "worker", "public"] as const satisfies readonly DbRoleKey[];

/**
 * Comment set on the roles and database this application creates. Setup
 * changes only objects carrying it, so a shared cluster's other databases
 * and roles (other Workeasy360 apps) are never touched.
 */
export const OWNERSHIP_MARK = "workeasy360-commerce";

/** Schema holding every application object. Runtime roles get it as search_path. */
export const APP_SCHEMA = "app";
