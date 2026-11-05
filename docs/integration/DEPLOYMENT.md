# Managed deployment setup

This checkout provides one Node service and a Python standard-library subprocess.
`Dockerfile` prepares both runtimes, runs as the `node` user and installs only
the pinned production packages. The image has not yet been built or deployed.

## Destination and account setup

The requested target is a fresh `floww-solana` setup: Infisical for server secrets,
an OpenAI project-scoped Responses key, Supabase PostgreSQL and a Render Free web
service in Singapore. Actual key issuance, DB creation and Render registration
are pending the specific browser confirmation. No credentials belong in this
repository or Docker build arguments. Do not copy credentials from the legacy
Floww, LALA or AFK projects.

Render Free has an [ephemeral filesystem and idle spin-down](https://render.com/docs/free).
The server therefore refuses remote mode without `DATABASE_URL`. Free Render
PostgreSQL expires after 30 days; this setup instead targets the separately
created Supabase database. Free-tier quotas remain a real provisioning gate;
do not pause an existing project or upgrade a paid tier to bypass them.

## Runtime configuration

Use `render.yaml` as the creation template after source review and tests. It
disables automatic deploys, selects the feature branch and keeps payments off.
Select the verified commit explicitly for a release; update the configured
branch if the integration is later merged. The default Render TCP probe only
proves that the process accepts connections, not payment or model readiness.

| Setting | Value or source |
| --- | --- |
| `FLOWW_DEPLOYMENT_MODE` | `remote` |
| `FLOWW_HOST` / `PORT` | `0.0.0.0` / `10000` |
| `FLOWW_PUBLIC_ORIGIN` | Exact public HTTPS origin; if absent, Render's `RENDER_EXTERNAL_URL` is used |
| `DATABASE_URL` | New DB connection string saved in Infisical; TLS certificate verification remains on |
| `OPENAI_API_KEY` | New restricted server key, saved in Infisical and injected only at runtime |
| `FLOWW_MODEL` | Explicit permitted model after bounded API verification |
| `MERCHANT_PAY_TO` | Public Devnet merchant wallet address, never a private key |
| `FLOWW_ENABLE_DEVNET_PAYMENTS` | `false` until the opt-in test payer and execution acceptance are configured |

For an IPv4-only persistent host, copy the Supabase **Session pooler** connection
string from the new project's Connect screen. Do not guess the pooler hostname.
The service uses a maximum pool of five connections and its own `floww_runtime`
schema. [Supabase connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres)
explains direct and pooled connection choices. Existing databases are untouched.

`FLOWW_PAYER_KEY_FILE` is optional while payments are disabled. Enabling it
requires a 64-byte Devnet keypair in an owner-readable, non-symlink mode-0600
file owned by the running process. A root-owned mounted secret that violates
these checks is rejected; do not weaken file permissions or embed the payer in
the image. Neither a configured key nor `ready:true` proves it has test funds.

## Acceptance and rollback

Before publishing, record the destination service ID, source commit, origin,
previous deployment and rollback target without secret values. Verify:

1. Source review, `npm run check`, Node/isolated PostgreSQL and Python checks.
2. Cloud build and process startup using the expected commit.
3. Public UI HTTP 200 without a hosting login redirect; exact-origin guards.
4. `/api/health` including `databaseReady` and explicit missing configuration.
   `ready` combines DB reachability with payment configuration. It does not probe
   funding, facilitator settlement, actual model output or a completed purchase.
5. Unauthenticated task/session requests return 401; mutations reject a missing
   or different Origin. Browser wallet approval, actual testnet settlement and
   resource delivery are separate acceptance steps.

Changing the public origin invalidates the wallet sign-in domain. Keep origin
configuration, cookie security and merchant resource URLs aligned. Roll back
code to the recorded previous working deployment if necessary; preserve durable
state and UNKNOWN payment proofs. Never clear a pending purchase or re-sign it
to make a health indicator green.

The API key currently being prepared is user-owned, restricted to Responses and
expires after seven days. Key configuration alone does not execute a model:
the explicit resource-selection path remains deterministic and labels its
execution kind accordingly. Record a real bounded model call separately if it
is run. No live key, DB or deployment claim is made by this document.
