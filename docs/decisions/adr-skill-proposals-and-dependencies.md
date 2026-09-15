# Skill proposals, publication, rollback and dependencies

Status: implemented for the skill lifecycle and bounded customer code.
Remote connectors remain unavailable.

Date: 2026-09-14.

Builds on: [shared workspaces](adr-zoen-shared-workspaces.md),
[C01 organization RBAC](adr-c01-org-workspace-rbac.md).

## Decision

Skills stay Markdown files in the workspace Git bundle. A member or bound
group participant writes a draft at `proposals/skills/<slug>.md` without
`manage`. An admin or owner publishes through `publishSkillProposal`, which
writes `skills/<slug>.md` and deletes the proposal in the same Git commit.
Rollback is a new forward revision of that skill file. Dependencies are a
strict `requires: [tool.path]` frontmatter list in the same file, so a skill
and its declared tools change together.

Authorship stays in `workspace_revision.author_user_id` and the
`Zoen-Metadata` commit trailer (`source` plus `proposal` or `revision`). Git
`GIT_AUTHOR_*` remains the constant workspace identity so exported bundles do
not carry user emails. The revision row is the publication receipt; personal
spaces have no organization audit table.

Executor `describe.skill` returns `execution: "instructions"` when every
required catalog path is present in this turn, or `execution: "blocked"`
with `missing` or `problem`. Discovery re-reads the catalog on every call.
A skill never changes grants, plugins or membership.

## Customer code and remote connectors

The bounded code implementation and its evidence now live in
[versioned customer tools](adr-customer-tools.md). Customer tools use the same
Executor catalog, content-versioned IDs and validated publication. Remote
MCP/OpenAPI connectors remain unavailable pending the dedicated transport,
authorization and live-provider proof. An integration calling itself read-only
does not change the authorization of its operations.

## Alternatives rejected

- Database rows for drafts: a second content store, no Git history, a
  migration.
- A `status` key inside `skills/*.md`: authorization would depend on parsing, and
  members cannot write `skills/`.
- Relaxing `manage` for bound groups so they can publish: groups would gain
  workspace administration.

## Evidence

`tests/runtime/workspace-skills.integration.ts` proves personal publish and
Code Mode use, member proposal versus admin publication, a bound group
proposal without `manage`, second revision plus rollback, concurrent
publication conflict, a malicious skill that does not change grants, and a
missing dependency returning `blocked`. `server/workspaces/git.test.ts`
covers the two-path commit. `server/workspaces/skill-document.test.ts`
covers the frontmatter grammar.
