# Security policy

## Supported versions

Zoen is in closed beta. Security fixes target the current `main` branch and its
latest qualified deployment. Earlier commits and unmaintained forks do not have
a supported backport line. Review migration and recovery requirements before
upgrading an installation.

## Private reporting

Use GitHub's enabled [private vulnerability reporting](https://github.com/EnzoTironi/tryzoen/security/advisories/new).
Include the affected revision, impact, minimal reproduction and suggested fix if
available. Use synthetic records and redact credentials and personal content.
Do not open a public issue with an exploit or private data while remediation is
being coordinated. This project does not currently offer a paid bounty or a
guaranteed response SLA.

Test only systems and accounts you own or are explicitly authorized to assess.
Do not access another user's data, disrupt shared services, persist access or
send unsolicited messages to demonstrate a finding.

## Boundaries to preserve

- Verify provider signatures and current account/workspace membership before
  accepting messages or retrieving data, including old versions and summaries.
- Separate personal and team credentials, private memories and group context.
  Git branches, room identifiers and A2A contexts grant no permission.
- Keep secrets encrypted and out of Git, model output, public artifacts and
  diagnostics. Browser autofill uses opaque references for credentials.
- Require explicit, current approval for the exact operation where policy
  requires it. Opening a URL or receiving a message is not approval.
- Keep database, memory, Matrix and internal execution callbacks private. Use
  separate application/migration roles and TLS at the public boundary.
- Preserve backups, recovery drills, release checks and dependency audits.

These are required boundaries, not a claim of immunity from vulnerabilities.
[Launch evidence](docs/decisions/zoen-launch-validation.md) records verification
and its limits. [PRIVACY.md](PRIVACY.md) describes diagnostic collection and
current deletion limits.
