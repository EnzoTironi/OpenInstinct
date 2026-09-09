# Local PostgreSQL with Alchemy and Effect

This stack provisions PostgreSQL 17 for the documented local application setup.
It uses `alchemy@2.0.0-beta.76`, Effect `4.0.0-rc.112`, and the active Docker CLI
context. Select a local Docker context before deploying. It creates three Alchemy
resources: a cached image reference, a named volume, and a running container with a
healthcheck. The published port is chosen by Docker and binds to `127.0.0.1`.

From the repository root, with Node 24 and Docker running:

```sh
pnpm install --frozen-lockfile
pnpm --dir infrastructure install --frozen-lockfile
cp infrastructure/.env.example infrastructure/.env
chmod 600 infrastructure/.env
pnpm --dir infrastructure plan --stage local
pnpm --dir infrastructure run deploy --stage local --yes
```

Set `COMPANION_POSTGRES_PASSWORD` in `infrastructure/.env` before deployment. The
example password is only for a disposable local database. The deployment prints
the container, volume and selected port without printing the password. Confirm
readiness with `docker inspect <container> --format '{{.State.Health.Status}}'`;
wait for `healthy` before migrating. Deployment completion alone does not wait
for the healthcheck.

Use the returned `5432/tcp` port in the application's `.env.local`:

```dotenv
DATABASE_URL=postgresql://postgres:<url-encoded-password>@127.0.0.1:<port>/open_instinct
DATABASE_URL_UNPOOLED=postgresql://postgres:<url-encoded-password>@127.0.0.1:<port>/open_instinct
```

Continue with `pnpm db:migrate`, `pnpm workflow:migrate`, `pnpm build`, and
`pnpm start` from the root [runtime setup](../docs/local-runtime-setup.md). This
stack is used with that launcher; the separate benchmark/development supervisors
still own their existing Compose databases.

Alchemy stores ownership and resource state in the ignored
`infrastructure/.alchemy` directory, including the serialized database password.
The package commands set a restrictive umask and create/protect this directory
with mode `0700` before invoking Alchemy. Use these package commands for local
state operations. Keep the directory while the resources exist, use the
same stage for later commands, and do not adopt unrelated containers or volumes.
A container replacement retains the unchanged volume but can change the published
port; update the application URLs when that happens. Do not run two deploys of
the same local stack concurrently.

To remove this stack, including its database contents:

```sh
pnpm --dir infrastructure destroy --stage local --yes
```

The image cache is retained by Alchemy's Docker provider. Destroy removes the
owned container and data volume. It does not reverse application migrations in
another database.

## Compatibility and evidence

The infrastructure package has its own lockfile and workspace boundary. Alchemy's
optional Drizzle peers differ from the application's versions. Its optional
Cap'n Proto compiler also declares an older TypeScript peer. Neither integration
is installed here. `types:check` uses the root's sole TS7 compiler; this package
does not install another compiler or override peer ranges.

The installed Docker API requires `{}` for the volume properties in this stack.
Its healthcheck command is a shell string; copying `CMD-SHELL` from a Compose
array into that string causes an unhealthy container. The initial failing plan
and healthcheck were retained during validation and corrected using the published
API, without patching Alchemy.

Local validation exercised a healthy loopback-only container, an actual PostgreSQL
write, container replacement preserving the row and volume, an unchanged redeploy,
and removal of the owned container and volume. A fresh final stack accepted both
application and Workflow migrations. These are local infrastructure checks, not
cloud deployment, backup, concurrent-deployment, or production qualification.

Sources: [Docker provider](https://alchemy.run/docker/),
[published package manifest](https://github.com/alchemy-run/alchemy/blob/v2.0.0-beta.76/packages/alchemy/package.json).
