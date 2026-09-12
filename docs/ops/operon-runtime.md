# Zoen and Operon runtime

Zoen keeps Eve as the owner of conversations, approvals, and durable tool state.
Operon runs over private stdio for each authenticated operation. `operon.lock`
pins the public Operon commit used by both the Docker image and CI.

## Running locally

With Node 24, Corepack, and Git installed:

```sh
sh scripts/prepare-operon.sh /tmp/zoen-operon
export OPERON_HOME=/tmp/zoen-operon
export OPERON_DATABASE_URL="$DATABASE_URL"
export OPERON_BUILDER_ENABLED=true
```

Choose a new checkout directory when rebuilding. The script refuses to overwrite
an existing checkout. Operon uses its own pinned pnpm version.

The Fly image includes this runtime at `/opt/operon`. Its entrypoint defaults
`OPERON_DATABASE_URL` to the application's durable PostgreSQL database. No token,
account credentials, or `.env` file belongs in the image. Operon creates its
workspace snapshot table on first use; application and workflow migrations retain
their existing deployment procedure.

## Implemented email flow

`email-sync` imports metadata from the authorized user's Gmail account, or a
supplied EML/MBOX export, for the last 30 days. Gmail uses the existing Google
Workspace OAuth connection and reports a partial result if the 1,000-message cap
is reached. One person record per email address enters quarantine. Import retries
reuse the same proposal when the content is unchanged.

`email-search` can find quarantined people before admission. It labels a person
as registered only when an admitted object and its admission receipt exist.
`email-register` requests Eve's approval for the pending proposal digest. The
private Operon callback then checks the live user, channel or web authority,
workspace membership, owning conversation, and exact proposal before returning a
short-lived human principal. Model-provided names and roles confer no authority.

Pending proposal state belongs to the conversation, not a global service. Operon
snapshots belong to the verified workspace. PostgreSQL serializes processes for
the same workspace and persists each mutation before acknowledging it. Consumer
tools cannot perform Builder writes.

## Verification and limits

The `Runtime storage and build` CI job builds `operon.lock`, runs real PostgreSQL
integration tests, then runs the actual MCP SDK against CLI subprocesses. It
checks workspace separation, concurrent imports, import/admission retries,
approval identity, and channel revocation. Operon's own CLI tests also kill the
process after a successful acknowledgement and verify the next process restores
the acknowledged state.

This is the email-to-person integration described above. It does not implement
every scenario in `docs/companion-operon-acceptance.json`. Google consent and
Telegram delivery require a configured installation and a live pilot. Calendar
tools retain their existing Google connection and Eve approval workflow; they do
not yet write an Operon action ledger. Gmail metadata import is not an archive of
original email bodies or attachments.

Operon currently stores one snapshot per workspace, so snapshot size and lock
duration must be measured as usage grows. The checkpoint guarantees do not make
external side effects transactional. See Operon's `docs/zoen-mcp.md` for that
runtime's storage and host approval contract.
