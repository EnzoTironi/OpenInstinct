# Local PostgreSQL with Alchemy and Effect

This stack provisions PostgreSQL 17 for documented application stages
(`local`, `dev`, and `staging`). It uses `alchemy@2.0.0-beta.76`, Effect
`4.0.0-rc.112`, and the active Docker CLI context. Select a local Docker
context before deploying. It creates three Alchemy resources: a cached image
reference, a named volume, and a running container with a healthcheck. The
published port is chosen by Docker and binds to `127.0.0.1`.

## Stage isolation

Alchemy stages are isolated instances of the same stack program:

- Each `--stage` gets its own state under `infrastructure/.alchemy`.
- Docker **physical names** for the container and volume include the stage, so
  `local`, `dev`, and `staging` never share Docker resources.
- Destroying one stage does not touch another stage's container or volume.
- This program also sets `POSTGRES_DB` to `open_instinct_<stage>` (hyphens in
  the stage name become underscores), for example `open_instinct_local`,
  `open_instinct_dev`, and `open_instinct_staging`.

Always pass an explicit `--stage`. Do not run two deploys of the same stage
concurrently. Do not adopt unrelated containers or volumes.

## Deploy

From the repository root, with Node 24 and Docker running:

```sh
pnpm install --frozen-lockfile
pnpm --dir infrastructure install --frozen-lockfile
cp infrastructure/.env.example infrastructure/.env
chmod 600 infrastructure/.env
```

Set `COMPANION_POSTGRES_PASSWORD` in `infrastructure/.env` before deployment.
The example password is only for a disposable local database. The deployment
prints the stage, database, container, volume, and selected port without
printing the password.

Plan / deploy / destroy per stage:

```sh
# local
pnpm --dir infrastructure plan --stage local
pnpm --dir infrastructure run deploy --stage local --yes
# or from root: pnpm infra:deploy:local

# dev
pnpm --dir infrastructure plan --stage dev
pnpm --dir infrastructure run deploy --stage dev --yes
# or from root: pnpm infra:deploy:dev

# staging
pnpm --dir infrastructure plan --stage staging
pnpm --dir infrastructure run deploy --stage staging --yes
# or from root: pnpm infra:deploy:staging
```

Confirm readiness with
`docker inspect <container> --format '{{.State.Health.Status}}'`; wait for
`healthy` before migrating. Deployment completion alone does not wait for the
healthcheck.

## Wire DATABASE_URL

Use the returned `5432/tcp` port and the stage database name. Examples only —
replace `<url-encoded-password>` and `<port>` with your values; do not commit
real secrets.

`.env.local` (stage `local`, database `open_instinct_local`):

```dotenv
DATABASE_URL=postgresql://postgres:<url-encoded-password>@127.0.0.1:<port>/open_instinct_local
DATABASE_URL_UNPOOLED=postgresql://postgres:<url-encoded-password>@127.0.0.1:<port>/open_instinct_local
```

`.env.dev` (stage `dev`, database `open_instinct_dev`):

```dotenv
DATABASE_URL=postgresql://postgres:<url-encoded-password>@127.0.0.1:<port>/open_instinct_dev
DATABASE_URL_UNPOOLED=postgresql://postgres:<url-encoded-password>@127.0.0.1:<port>/open_instinct_dev
```

`.env.staging` (stage `staging`, database `open_instinct_staging`):

```dotenv
DATABASE_URL=postgresql://postgres:<url-encoded-password>@127.0.0.1:<port>/open_instinct_staging
DATABASE_URL_UNPOOLED=postgresql://postgres:<url-encoded-password>@127.0.0.1:<port>/open_instinct_staging
```

Continue with `pnpm db:migrate`, `pnpm workflow:migrate`, `pnpm build`, and
`pnpm start` from the root [runtime setup](../docs/local-runtime-setup.md)
(pointing the launcher at the matching env file). The separate
benchmark/development supervisors still own their existing Compose databases.

## State and destroy

Alchemy stores ownership and resource state in the ignored
`infrastructure/.alchemy` directory, including the serialized database password.
The package commands set a restrictive umask and create/protect this directory
with mode `0700` before invoking Alchemy. Use these package commands for local
state operations. Keep the directory while the resources exist, and use the
same stage for later commands. A container replacement retains the unchanged
volume but can change the published port; update the application URLs when that
happens.

To remove a stage, including its database contents:

```sh
pnpm --dir infrastructure destroy --stage local --yes
pnpm --dir infrastructure destroy --stage dev --yes
pnpm --dir infrastructure destroy --stage staging --yes
```

The image cache is retained by Alchemy's Docker provider. Destroy removes the
owned container and data volume for that stage only. It does not reverse
application migrations in another database or another stage.

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
[stages](https://alchemy.run/environments/stages),
[published package manifest](https://github.com/alchemy-run/alchemy/blob/v2.0.0-beta.76/packages/alchemy/package.json).
