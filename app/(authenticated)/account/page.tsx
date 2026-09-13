import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  BrainIcon,
  ChevronRightIcon,
  CreditCardIcon,
  KeyRoundIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  UserRoundIcon,
  MonitorIcon,
} from "lucide-react";
import { getAuthSession } from "@db/services/auth/session";
import { readEntitlement } from "@db/services/billing";
import { getGatewayModel } from "@db/services/settings";
import { requireRequestScope } from "@web/auth/request-scope";
import { PersonalMemorySection } from "./personal-memory";
import {
  isStripeBillingConfigured,
  isStripePortalConfigured,
} from "../../../server/billing/stripe";
import { AccountBillingSection } from "./_components/billing-section";
import { AccountPrivacyWipeSection } from "./_components/privacy-wipe-section";
import { AuthenticatedAccountControl } from "./_components/account-control";
import { ModelSelector } from "./_components/model-selector";
import { PanelIntro } from "../_components/panel-intro";
import styles from "../_components/panel.module.css";

const sections = [
  { id: "channels", label: "Seus mensageiros." },
  { id: "memory", label: "O que fica com você." },
  { id: "preferences", label: "Do seu jeito." },
  { id: "plan", label: "Seu plano." },
  { id: "privacy", label: "Sua privacidade." },
  { id: "advanced", label: "Sua inteligência." },
] as const;

const accountLinks = [
  {
    href: "/personal-info",
    label: "Dados pessoais",
    icon: UserRoundIcon,
  },
  { href: "/account?section=memory", label: "Memória", icon: BrainIcon },
  {
    href: "/account?section=preferences",
    label: "Preferências",
    icon: SlidersHorizontalIcon,
  },
];
const preferenceLinks = [
  { href: "/personal-info", label: "Dados pessoais", icon: UserRoundIcon },
  { href: "/vault", label: "Cofre", icon: KeyRoundIcon },
  { href: "/account?section=plan", label: "Seu plano", icon: CreditCardIcon },
  { href: "/account?section=advanced", label: "Inteligência", icon: BrainIcon },
  {
    href: "/account?section=privacy",
    label: "Privacidade",
    icon: ShieldCheckIcon,
  },
  { href: "/tasks", label: "Atividade no navegador", icon: MonitorIcon },
];

export default async function AccountPage({
  searchParams,
}: PageProps<"/account">) {
  const params = await searchParams;
  const section = sections.find(({ id }) => id === params.section);
  const session = await getAuthSession(await headers());
  if (!session) redirect("/sign-in?callbackUrl=%2Faccount");
  return (
    <div className={styles.page}>
      {section ? (
        <>
          <h1 className="type-page-title">{section.label}</h1>
          <AccountSection section={section.id} userId={session.user.id} />
        </>
      ) : (
        <>
          <PanelIntro
            image="/marketing/panel/zoen-friendly.jpg"
            title="Seu Zoen. Seu espaço."
          />
          <AccountLinks links={accountLinks} />
          <div className={styles.actions}>
            <AuthenticatedAccountControl />
          </div>
        </>
      )}
    </div>
  );
}

function AccountLinks({ links }: { readonly links: typeof accountLinks }) {
  return (
    <nav aria-label="Configurações da conta" className={styles.actionList}>
      {links.map(({ href, label, icon: Icon }) => (
        <Link href={href} key={href}>
          <Icon aria-hidden="true" />
          {label}
          <ChevronRightIcon aria-hidden="true" />
        </Link>
      ))}
    </nav>
  );
}

async function AccountSection({
  section,
  userId,
}: {
  readonly section: (typeof sections)[number]["id"];
  readonly userId: string;
}) {
  switch (section) {
    case "channels":
      return redirect("/connections?messengers=1");
    case "memory":
      return <PersonalMemorySection />;
    case "preferences":
      return <AccountLinks links={preferenceLinks} />;
    case "plan":
      return <AccountPlan userId={userId} />;
    case "privacy":
      return <AccountPrivacyWipeSection />;
    case "advanced":
      return (
        <section className={styles.sectionCard}>
          <h2 className="type-section-title mb-4">Modelo das conversas</h2>
          <ModelSelector
            modelId={await getGatewayModel(await requireRequestScope())}
          />
        </section>
      );
  }
  return null;
}

async function AccountPlan({ userId }: { readonly userId: string }) {
  const entitlement = await readEntitlement("user", userId).catch(() => ({
    plan: "free" as const,
    status: "active",
    seatCount: 1,
  }));
  return (
    <AccountBillingSection
      plan={entitlement.plan}
      seatCount={entitlement.seatCount}
      status={entitlement.status}
      stripeCheckoutConfigured={isStripeBillingConfigured()}
      stripePortalConfigured={isStripePortalConfigured()}
    />
  );
}
