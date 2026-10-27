# Deployment (AWS)

One EC2 server runs the app with Docker Compose: Caddy (HTTPS), the admin, the storefront, the API, the worker and the ClamAV malware scanner.

- **Database:** the shared Workeasy360 Aurora/RDS cluster.
- **Files:** Amazon S3.
- **Email:** Amazon SES.
- **Settings:** one AWS Secrets Manager secret.

GitHub Actions builds one Docker image per commit and deploys it over SSH. The server files are in `infra/aws/`, and the workflow is `.github/workflows/deploy-aws.yml`.

## How a release goes out

1. **CI** (`.github/workflows/ci.yml`) runs on every push: lint, typecheck, tests, build, bundle checks, the accessibility audit and the page budgets.
2. When CI passes on `main`, **Deploy to AWS**:
   - builds `ghcr.io/<owner>/workeasy-commerce:<commit>` and copies `infra/aws/` to `/opt/workeasy-commerce` on the server;
   - runs `deploy.sh`, which reads the settings secret, migrates the database, starts the new release and waits for every health check;
   - if the new release isn't healthy within five minutes, puts the previous one back.

On the server:
- `sudo /opt/workeasy-commerce/deploy.sh --status` shows the recent releases.
- `sudo /opt/workeasy-commerce/deploy.sh --rollback` goes back one release.

## Database isolation on the shared cluster

This app owns exactly one database, `workeasy_commerce`, and four roles: `wec_owner`, `wec_api`, `wec_worker` and `wec_public`. Role names are global to a PostgreSQL cluster, so they carry the app's own prefix. They never collide with other Workeasy360 apps, such as the form builder's `workeasy_*` roles.

- **Setup changes only what it created.** It marks its roles and database with a comment. It refuses to alter any role or database without that mark, even one with the same name. A test checks this.
- **Other apps' roles can't connect.** `CONNECT` on `workeasy_commerce` is revoked from everyone except the four `wec_*` roles.
- **Runtime roles stay powerless.** They can't create databases or roles, and row-level security always applies to them.
- **The master user is needed only once.** It is used for the first deploy, when the database and roles are created, and later only to change a role password. Remove it from the secret afterwards.
- **Connections are verified.** They use TLS with the cluster's certificate checked (`sslmode=verify-full`, using Amazon's RDS CA bundle).
- **Any recent PostgreSQL works.** Aurora PostgreSQL 13 or later is fine; on versions before 18, `uuidv7()` is provided by the app.

## One-time AWS setup

The examples use `ap-south-1` (Mumbai). Use your region throughout.

1. **EC2:**
   - Ubuntu 24.04, `t3.large` (8 GB), 40 GB gp3 disk.
   - An Elastic IP attached.
   - Security group:
     - 80 and 443 from anywhere;
     - 22 from your IP only.
   - Run `sudo bash ec2-setup-ubuntu.sh` once.
2. **Database access:**
   - Same region and VPC as the server: in the database's security group, allow port 5432 from the EC2 server's security group.
   - Another region (the current setup: server in Singapore, database in Stockholm): allow port 5432 from the server's Elastic IP only (`/32`), never from anywhere. Expect slower pages, since every query crosses regions. Moving the server into the database's region removes that.
   - Nothing else changes on the database server.
3. **S3:**
   - Create three private buckets: quarantine, media and exports. Example: `workeasy-commerce-media-<account-id>`.
   - Block public access on all three.
   - Apply `iam/tls-only-bucket-policy.json` to each, with the bucket name filled in.
   - Set `iam/quarantine-cors.json` as the quarantine bucket's CORS, with the admin address filled in.
4. **IAM role for the server:**
   - Create a role for EC2 with `iam/instance-policy.json`, filling in the bucket names, region and account ID.
   - Attach it to the instance.
   - The app then reaches S3 and Secrets Manager with no stored keys.
5. **SES:**
   - Verify the `workeasy360.com` domain (DKIM records).
   - Request production access, so mail reaches any address.
   - Create SMTP credentials.
6. **Settings secret:**
   - Run `bash infra/aws/new-secrets.sh` for fresh passwords and keys.
   - Fill in a copy of `infra/aws/env.example`.
   - Store it as the secret `workeasy-commerce/production/env`, in the server's region.

## GitHub setup

Add these under the repository's **Settings → Secrets and variables → Actions**:

| Kind | Name | Value |
|---|---|---|
| Secret | `EC2_HOST` | The Elastic IP |
| Secret | `EC2_USER` | `ubuntu` |
| Secret | `EC2_SSH_KEY` | The whole private key (`.pem`) |
| Secret | `EC2_KNOWN_HOSTS` | Output of `ssh-keyscan <elastic-ip>` (recommended) |
| Variable | `DOMAIN` | The admin address, e.g. `admin.13-233-10-20.sslip.io`, checked after each deploy |

Until `EC2_HOST` is set, the deploy workflow does nothing.

## Addresses

Until the real domain is ready, the app uses sslip.io names, which resolve to the IP they contain without any DNS setup. For an Elastic IP of `13.233.10.20`:
- admin: `admin.13-233-10-20.sslip.io`
- storefront: `shop.13-233-10-20.sslip.io`

Caddy gets real Let's Encrypt certificates for both.

To move to the real domain:
1. Add A records, e.g. `admin.workeasy360.com` and `shop.workeasy360.com`, pointing at the Elastic IP.
2. Update the four address lines in the secret.
3. Update the quarantine bucket's CORS and the `DOMAIN` variable.
4. Redeploy.

Merchants' own shop domains (Settings → Domain) point a CNAME at the storefront address. Caddy issues their certificates on first visit, after the API confirms the domain is verified.

## To do before real launch

Shortcuts taken for the first deploy, to tighten later:

- **Quarantine bucket CORS allows uploads from any website** (`"AllowedOrigins": ["*"]`). Uploads still need a short-lived signed link that only the app issues, so this is safe for testing. Before launch, restrict it to the admin address: `infra/aws/iam/quarantine-cors.json`, with `ADMIN_DOMAIN` filled in. Change it again whenever the admin address changes, for example when moving from sslip.io to the real domain.
- **Addresses are sslip.io names.** Move to the real domain as described under Addresses.
- **SSH (port 22) is open to one IP.** GitHub Actions deploys over SSH, so it can't simply be closed. Options: allow GitHub's runner ranges, or switch deploys to AWS Systems Manager.

## Accessibility and performance checks

Both checks run against a running stack. CI runs them against the production build.

```sh
pnpm check:a11y [--out dir]          # axe (WCAG 2.2 AA) on every admin module and storefront page
pnpm check:budgets --store <slug>    # gzipped JavaScript per page, against production servers
```

Budgets:
- storefront pages: 200 KB;
- admin pages: 250 KB.
