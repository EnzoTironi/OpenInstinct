# Agent evals

The eval tree has three tiers:

- `launch/` is the required native-Eve release suite: Executor discovery and
  Git-backed skills in English, Portuguese and Spanish, exact native approval,
  and a live Kernel browser. It uses synthetic workspace data and live models.

- `agent/` is the behavioral regression suite for the root coordinator. It
  covers conversation quality, tool routing, safety and approval boundaries,
  memory isolation, personal information, scheduled execution and reporting,
  and worker orchestration.
- `browser/` is the slower end-to-end browser benchmark. It exercises real
  sites and records benchmark-specific timing, cost, and completion artifacts.

Directories are the grouping and filtering boundary. Each `.eval.ts` file owns
one behavior family, and array cases within a file share the same setup without
hiding their individual descriptions in the runner output.

## Running the suites

List every discovered case without making model calls:

```sh
pnpm eval:list
```

List launch cases without credentials:

```sh
pnpm eval:agent --list
```

Run the launch suite against a prepared isolated app:

```sh
pnpm eval:agent --url http://127.0.0.1:4351 --repeat 3
```

Produce JUnit output for CI:

```sh
pnpm eval:ci --url http://127.0.0.1:4351
```

The launcher uses the installed Eve CLI directly, creates a temporary synthetic
Better Auth identity and workspace for each repetition, and refuses non-loopback
targets or databases other than `companion_runtime_test`. The app and migrated
PostgreSQL instance must already be running. It preserves the app's chosen models;
browser cases also require Kernel on the server. The **Zoen native agent evals**
GitHub workflow prepares and removes this complete isolated environment.

Use `--suite agent --tag safety` or `--suite agent --tag routing` to select a
behavioral family. These older families are not implied by a passing launch run.
Judge-backed cases use the judge in `evals.config.ts` and need that provider's
credentials. Full native traces stay in `.eve/evals/`; only summary receipts and
JUnit are uploaded by CI. Summaries omit model replies, inputs, provider error
messages and credentials. All requested repetitions run, and any failed or
skipped required case fails the command. See the
[launch ledger](../docs/decisions/zoen-launch-validation.md) for coverage and
current results.

Run the browser benchmark separately because it uses Kernel, real websites,
and a longer completion loop:

```sh
pnpm bench:browser
```

See `browser/README.md` for benchmark suites, repetitions, A/B runs, and its
dashboard.

## What should be a gate

Use deterministic gates for observable contracts: the selected tool, a pending
approval, an absent secret canary, a required delivery, or a worker boundary.
Use the judge only for qualities that cannot be expressed safely as an exact
match, such as decisiveness, concise wording, or whether a free-form answer
actually satisfies the request. Judge thresholds are soft in Eve, so run this
suite with `--strict` when regressions should fail the command.

When a production failure appears, add the smallest sanitized reproduction to
the owning family. Add a new family only when it represents a genuinely new
contract. Avoid examples that can send, purchase, delete, or otherwise mutate
external state; approval evals should stop while the action is still pending.
