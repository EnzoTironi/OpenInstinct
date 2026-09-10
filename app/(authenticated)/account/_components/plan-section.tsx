import { Badge } from "@web/components/ui/badge";

const planRows = [
  {
    id: "free",
    name: "Free",
    detail: "Personal Companion with fair-use quotas. No card required.",
  },
  {
    id: "pro",
    name: "Pro",
    detail: "Higher personal limits for daily heavy use.",
  },
  {
    id: "org",
    name: "Org",
    detail: "Seat-based plan for teams and shared company workspaces.",
  },
] as const;

/**
 * Lightweight plan entry for the account page.
 * C-BILL (#42) adds `/pricing`, Stripe Checkout, and Customer Portal — keep this
 * section presentational so billing UI can replace the CTA without reshaping
 * channels or personal-memory layout.
 */
export interface AccountPlanSectionProps {
  readonly planName?: string;
  readonly workspaceKind?: "personal" | "organization";
}

export function AccountPlanSection({
  planName = "Free",
  workspaceKind = "personal",
}: AccountPlanSectionProps) {
  const workspaceLabel =
    workspaceKind === "organization" ? "Organization" : "Personal";

  return (
    <section
      aria-labelledby="plan-heading"
      className="space-y-4 rounded-xl border p-4 sm:p-6"
      id="plan"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h2 id="plan-heading" className="type-section-title">
            Plan and billing
          </h2>
          <p className="type-supporting-body text-muted-foreground">
            You are on <span className="text-foreground">{planName}</span> for a{" "}
            <span className="text-foreground">
              {workspaceLabel.toLowerCase()} workspace
            </span>
            . Free never requires a card.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{planName}</Badge>
          <Badge variant="outline">{workspaceLabel}</Badge>
        </div>
      </div>

      <ul className="divide-y rounded-xl border">
        {planRows.map((plan) => (
          <li
            className="flex flex-wrap items-start justify-between gap-3 p-4"
            key={plan.id}
          >
            <div className="min-w-0 space-y-1">
              <p className="type-label">{plan.name}</p>
              <p className="type-caption text-muted-foreground">
                {plan.detail}
              </p>
            </div>
            {plan.name === planName ? (
              <Badge variant="success">Current</Badge>
            ) : null}
          </li>
        ))}
      </ul>

      <ul className="list-disc space-y-1 pl-5 type-caption text-muted-foreground">
        <li>
          Personal accounts keep messengers, memory, and billing on this page.
        </li>
        <li>
          Organization seats are for shared company workspaces — not a rename of
          this personal account.
        </li>
      </ul>

      <p className="type-caption text-muted-foreground">
        Paid upgrades and the billing portal will appear here when hosted
        billing is enabled. Until then, Free covers personal use without a card.
      </p>
    </section>
  );
}
