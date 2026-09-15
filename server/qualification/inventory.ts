import { Schema } from "effect";

const EvidenceKind = Schema.Literals(["contract", "integration", "live"]);
const Result = Schema.Literals(["passed", "failed", "blocked"]);
const Family = Schema.Literals([
  "tool",
  "skill",
  "eval",
  "capacity",
  "observability",
  "fault",
  "release",
]);
const Surface = Schema.Literals(["coordinator", "browser", "all"]);
const Provider = Schema.Literals([
  "none",
  "google",
  "telegram",
  "whatsapp",
  "vaultwarden",
  "matrix",
  "mem0",
  "kernel",
  "model",
]);

const QualificationRowSchema = Schema.Struct({
  id: Schema.String,
  family: Family,
  path: Schema.String,
  surface: Surface,
  provider: Provider,
  advertised: Schema.Boolean,
  fixture: Schema.Struct({
    kind: EvidenceKind,
    result: Result,
    proof: Schema.String,
  }),
  live: Schema.Struct({
    result: Result,
    cause: Schema.String,
  }),
});

export type QualificationRow = typeof QualificationRowSchema.Type;

const live = {
  google: "No live Google OAuth in this environment.",
  telegram: "No live Telegram bot in this environment.",
  whatsapp: "No live mautrix or WhatsApp session in this environment.",
  vaultwarden: "No live Vaultwarden in this environment.",
  matrix: "No Synapse in this environment.",
  mem0: "No live Mem0 journey in this environment.",
  kernel: "No Kernel browser session in this qualification run.",
  model: "Launch evals were listed, not executed against a live model.",
  load: "Closed-beta load, soak and burst were not measured.",
  spark: "No authorized Codex Spark connection; Luna remains the baseline.",
  alert: "No operational alert destination was exercised.",
  none: "Live user/provider journey was not run.",
} as const;

const blocked = (cause: string) =>
  ({ result: "blocked" as const, cause }) satisfies QualificationRow["live"];

const fixture = (
  kind: QualificationRow["fixture"]["kind"],
  proof: string
): QualificationRow["fixture"] => ({
  kind,
  result: "passed",
  proof,
});

const blockedFixture = (
  kind: QualificationRow["fixture"]["kind"],
  proof: string
): QualificationRow["fixture"] => ({
  kind,
  result: "blocked",
  proof,
});

const tool = (
  path: string,
  surface: QualificationRow["surface"],
  provider: QualificationRow["provider"],
  proof: string,
  kind: QualificationRow["fixture"]["kind"],
  cause: string
): QualificationRow => ({
  id: `tool:${path}`,
  family: "tool",
  path,
  surface,
  provider,
  advertised: true,
  fixture: fixture(kind, proof),
  live: blocked(cause),
});

const coordinator = (
  path: string,
  provider: QualificationRow["provider"],
  proof: string,
  kind: QualificationRow["fixture"]["kind"] = "integration"
) =>
  tool(
    path,
    "coordinator",
    provider,
    proof,
    kind,
    provider === "none" ? live.none : live[provider]
  );

const browser = (
  path: string,
  provider: QualificationRow["provider"],
  proof: string,
  kind: QualificationRow["fixture"]["kind"] = "contract"
) =>
  tool(
    path,
    "browser",
    provider,
    proof,
    kind,
    provider === "none" ? live.none : live[provider]
  );

const files = "tests/runtime/executor-codemode.integration.ts";
const skills = "tests/runtime/workspace-skills.integration.ts";
const whatsapp = "tests/runtime/whatsapp-bridge.integration.ts";
const vault = "tests/runtime/vault-delegation.integration.ts";
const artifacts = "tests/runtime/artifacts.integration.ts";
const schedules = "tests/runtime/team-schedules.integration.ts";
const device = "tests/runtime/device-link.integration.ts";
const memory = "tests/runtime/personal-memory.integration.ts";
const ontology = "tests/runtime/workspace-ontology.integration.ts";
const google = "tests/runtime/team-connections.integration.ts";
const boundaries = "tests/agent-tool-boundaries.test.ts";
const learned = "tests/runtime/learned-memory.integration.ts";
const launchExecutor = "evals/launch/executor.eval.ts";
const launchApproval = "evals/launch/approval.eval.ts";
const launchBrowser = "evals/launch/browser.eval.ts";
const observations = "tests/runtime/observability.integration.ts";
const reporter = "tests/launch-reporter.test.ts";

const rows: readonly QualificationRow[] = [
  coordinator("search", "none", files),
  coordinator("describe.tool", "none", files),
  coordinator("describe.skill", "none", skills),
  coordinator("web_fetch", "none", boundaries, "contract"),
  coordinator("workspace-save", "none", launchExecutor, "contract"),
  coordinator("workspace.files.list", "none", files),
  coordinator("workspace.files.read", "none", files),
  coordinator("workspace.files.search", "none", files),
  coordinator(
    "workspace.tools.connections",
    "none",
    "tests/runtime/customer-connectors.integration.ts"
  ),
  coordinator("workspace.memory.search", "mem0", learned),
  coordinator("workspace.ontology.read", "none", ontology),
  coordinator("workspace.google.mail.search", "google", google),
  coordinator("workspace.google.calendar.list", "google", google),
  coordinator("workspace.google.contacts.search", "google", google),
  coordinator("ontology-action", "none", ontology),
  coordinator("gmail-read-thread", "google", google),
  coordinator("gmail-search", "google", google),
  coordinator("gmail-send", "google", google),
  coordinator("gmail-update", "google", google),
  coordinator("calendar-check-availability", "google", google),
  coordinator("calendar-create-event", "google", google),
  coordinator("calendar-list-events", "google", google),
  coordinator("contacts-search", "google", google),
  coordinator("request_vault_import", "vaultwarden", vault),
  coordinator("request_vault_setup", "vaultwarden", vault),
  coordinator("whatsapp-list-chats", "whatsapp", whatsapp),
  coordinator("whatsapp-read-messages", "whatsapp", whatsapp),
  coordinator("whatsapp-send", "whatsapp", whatsapp),
  coordinator("schedules-answer", "none", schedules),
  coordinator("schedules-create", "none", schedules),
  coordinator("schedules-list", "none", schedules),
  coordinator("schedules-update", "none", schedules),
  coordinator("artifacts-read", "none", artifacts),
  coordinator("artifacts-list", "none", artifacts),
  coordinator("artifacts-delete", "none", artifacts),
  coordinator("device-auth-start", "none", device),
  coordinator("device-auth-status", "none", device),
  coordinator("device-auth-confirm", "none", device),
  coordinator("personal-memory-inspect", "none", memory),
  browser("manage_browsers", "kernel", launchBrowser),
  browser("computer_action", "kernel", boundaries),
  browser("capture_browser_image", "kernel", boundaries),
  browser("fill_from_vault", "vaultwarden", vault),
  browser("list_vault", "vaultwarden", vault),
  browser("browser_act", "kernel", launchBrowser),
  browser("browser_find", "kernel", boundaries),
  browser("browser_snapshot", "kernel", launchBrowser),
  browser("browser_text", "kernel", boundaries),
  browser("browser_wait_for", "kernel", boundaries),
  browser("playwright_execute", "kernel", launchBrowser),
  {
    id: "skill:publication",
    family: "skill",
    path: "skills/*",
    surface: "coordinator",
    provider: "none",
    advertised: true,
    fixture: fixture("integration", skills),
    live: blocked(live.none),
  },
  {
    id: "eval:launch/executor",
    family: "eval",
    path: "evals/launch/executor.eval.ts",
    surface: "coordinator",
    provider: "model",
    advertised: true,
    fixture: fixture("contract", reporter),
    live: blocked(live.model),
  },
  {
    id: "eval:launch/approval",
    family: "eval",
    path: "evals/launch/approval.eval.ts",
    surface: "coordinator",
    provider: "model",
    advertised: true,
    fixture: fixture("contract", launchApproval),
    live: blocked(live.model),
  },
  {
    id: "eval:launch/browser",
    family: "eval",
    path: "evals/launch/browser.eval.ts",
    surface: "browser",
    provider: "kernel",
    advertised: true,
    fixture: fixture("contract", reporter),
    live: blocked(live.kernel),
  },
  {
    id: "eval:spark-vs-luna",
    family: "eval",
    path: "spark-vs-luna",
    surface: "all",
    provider: "model",
    advertised: false,
    fixture: blockedFixture(
      "live",
      "docs/decisions/adr-qualification-ledger.md"
    ),
    live: blocked(live.spark),
  },
  {
    id: "OP01",
    family: "capacity",
    path: "closed-beta-load",
    surface: "all",
    provider: "none",
    advertised: false,
    fixture: blockedFixture(
      "live",
      "docs/decisions/adr-qualification-ledger.md"
    ),
    live: blocked(live.load),
  },
  {
    id: "OP02",
    family: "capacity",
    path: "burst-and-quota",
    surface: "all",
    provider: "none",
    advertised: false,
    fixture: blockedFixture(
      "live",
      "docs/decisions/adr-qualification-ledger.md"
    ),
    live: blocked(
      "Burst and insufficient-quota behavior were not measured. Quota exhaustion is not a pass."
    ),
  },
  {
    id: "OP03",
    family: "capacity",
    path: "soak",
    surface: "all",
    provider: "none",
    advertised: false,
    fixture: blockedFixture(
      "live",
      "docs/decisions/adr-qualification-ledger.md"
    ),
    live: blocked(live.load),
  },
  {
    id: "OP04",
    family: "fault",
    path: "provider-unavailable",
    surface: "all",
    provider: "none",
    advertised: false,
    fixture: fixture("integration", `${whatsapp}, ${vault}`),
    live: blocked(
      "Fail-closed requireVaultwarden and requireWhatsAppBridge are proved. Live PostgreSQL/Mem0/worker kill was not injected in this run."
    ),
  },
  {
    id: "OP05",
    family: "eval",
    path: "unique-vs-repetitions",
    surface: "all",
    provider: "model",
    advertised: false,
    fixture: fixture("contract", reporter),
    live: blocked(live.model),
  },
  {
    id: "OP06",
    family: "observability",
    path: "correlated-redacted-trace",
    surface: "all",
    provider: "none",
    advertised: false,
    fixture: fixture("integration", observations),
    live: blocked("No live Executor/A2A/model delivery trace was captured."),
  },
  {
    id: "OP07",
    family: "observability",
    path: "enterprise-dashboard-isolation",
    surface: "all",
    provider: "none",
    advertised: false,
    fixture: fixture("integration", observations),
    live: blocked("No live two-company dashboard journey was run."),
  },
  {
    id: "OP08",
    family: "observability",
    path: "controlled-fault-alert",
    surface: "all",
    provider: "none",
    advertised: false,
    fixture: blockedFixture(
      "live",
      "docs/decisions/adr-qualification-ledger.md"
    ),
    live: blocked(live.alert),
  },
  {
    id: "REL01",
    family: "release",
    path: "same-sha-gates",
    surface: "all",
    provider: "none",
    advertised: false,
    fixture: fixture(
      "contract",
      "docs/decisions/adr-customer-platform-release.md"
    ),
    live: blocked(
      "eval:ci and full test:runtime were not executed in this authoring VM. Per-SHA check/build/eval:list belong on the PR, not as a standing live pass."
    ),
  },
  {
    id: "REL02",
    family: "release",
    path: "alchemy-publish",
    surface: "all",
    provider: "none",
    advertised: false,
    fixture: blockedFixture(
      "live",
      "docs/decisions/adr-customer-platform-release.md"
    ),
    live: blocked(
      "Alchemy publish, image digests, recovery drill and post-deploy health were not run for this SHA."
    ),
  },
  {
    id: "REL03",
    family: "release",
    path: "capability-map",
    surface: "all",
    provider: "none",
    advertised: false,
    fixture: fixture(
      "contract",
      "docs/decisions/adr-customer-platform-release.md"
    ),
    live: blocked("This SHA was not published to the hosted beta."),
  },
];

export const qualificationEvidence = Schema.decodeUnknownSync(
  Schema.Array(QualificationRowSchema)
)(rows);

export const advertisedToolPaths = qualificationEvidence
  .filter((row) => row.family === "tool" && row.advertised)
  .map((row) => row.path);

export const closedBetaEnvelope = {
  activeUsers: 25,
  concurrentAgentTasks: 5,
  burst: 10,
  loadMinutes: 30,
  soakHours: 24,
  apiP95Ms: 1000,
  queueP95Ms: 10_000,
  measured: false,
} as const;

export function livePassedRows(
  evidence: readonly QualificationRow[] = qualificationEvidence
) {
  return evidence.filter((row) => row.live.result === "passed");
}

export function toolsMissingEvidence(discovered: readonly string[]) {
  const known = new Set(advertisedToolPaths);
  return discovered.filter((path) => !known.has(path));
}

export function qualifyCapacity(sample: {
  measured: boolean;
  quotaInsufficient?: boolean;
  scopeLeaks?: number;
  duplicateExternalEffects?: number;
  lostAcceptedMessages?: number;
  continuedAfterRevocation?: number;
}) {
  if (!sample.measured)
    return {
      result: "blocked" as const,
      cause: "capacity envelope is not measured",
    };
  if (sample.quotaInsufficient)
    return {
      result: "blocked" as const,
      cause: "insufficient quota is not a passing measurement",
    };
  if (
    (sample.scopeLeaks ?? 0) > 0 ||
    (sample.duplicateExternalEffects ?? 0) > 0 ||
    (sample.lostAcceptedMessages ?? 0) > 0 ||
    (sample.continuedAfterRevocation ?? 0) > 0
  )
    return {
      result: "failed" as const,
      cause: "capacity sample violated a zero-leak criterion",
    };
  return { result: "passed" as const };
}
