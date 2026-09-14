import { getI18n } from "@web/i18n/server";
import { env } from "@shared/environment";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  BrainIcon,
  ChevronRightIcon,
  CreditCardIcon,
  KeyRoundIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  UserRoundIcon,
  MonitorIcon,
  ArchiveIcon,
} from "lucide-react";
import { getAuthSession } from "@db/services/auth/session";
import { readEntitlement } from "@db/services/billing";
import { getGatewayModel } from "@db/services/settings";
import { requireRequestScope } from "@web/auth/request-scope";
import { PersonalMemorySection } from "./personal-memory";
import {
  isStripeBillingConfigured,
  isStripePortalConfigured,
} from "../../../../server/billing/stripe";
import { AccountBillingSection } from "./_components/billing-section";
import { AccountPrivacyWipeSection } from "./_components/privacy-wipe-section";
import { AuthenticatedAccountControl } from "./_components/account-control";
import { ModelSelector } from "./_components/model-selector";
import { PanelIntro } from "../../_components/panel-intro";
import { LanguagePicker } from "@web/i18n/language-picker";
import styles from "../../_components/panel.module.css";
import { PanelLink } from "../../_components/panel-link";

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
  { href: "/space/memory", label: "Memória", icon: BrainIcon },
  { href: "/space/profile", label: "Seu username", icon: UserRoundIcon },
  { href: "/account/archives", label: "Contas anteriores", icon: ArchiveIcon },
  {
    href: "/account?section=preferences",
    label: "Preferências",
    icon: SlidersHorizontalIcon,
  },
] as const;
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
] as const;

export default async function AccountPage({
  searchParams,
}: PageProps<"/account">) {
  const { t } = await getI18n();
  const params = await searchParams;
  const section = sections.find(({ id }) => id === params.section);
  const session = await getAuthSession(await headers());
  if (!session) redirect("/sign-in?callbackUrl=%2Faccount");
  return (
    <div className={styles.page}>
      {section ? (
        <>
          <h1 className="type-page-title">{t(section.label)}</h1>
          <AccountSection section={section.id} userId={session.user.id} />
        </>
      ) : (
        <>
          <PanelIntro
            image="/marketing/panel/zoen-friendly.jpg"
            title={t("Seu Zoen. Seu espaço.")}
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

async function AccountLinks({
  links,
}: {
  readonly links: readonly (
    | (typeof accountLinks)[number]
    | (typeof preferenceLinks)[number]
  )[];
}) {
  const { t } = await getI18n();
  return (
    <nav aria-label={t("Configurações da conta")} className={styles.actionList}>
      {links.map(({ href, label, icon: Icon }) => (
        <PanelLink href={href} key={href}>
          <Icon aria-hidden="true" />
          {t(label)}
          <ChevronRightIcon aria-hidden="true" />
        </PanelLink>
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
  const { t } = await getI18n();
  switch (section) {
    case "channels":
      return redirect("/connections?messengers=1");
    case "memory":
      return <PersonalMemorySection />;
    case "preferences":
      return (
        <>
          <LanguagePicker />
          <AccountLinks links={preferenceLinks} />
        </>
      );
    case "plan":
      return <AccountPlan userId={userId} />;
    case "privacy":
      return <AccountPrivacyWipeSection />;
    case "advanced":
      return (
        <section className={styles.sectionCard}>
          <h2 className="type-section-title mb-4">
            {t("Modelo das conversas")}
          </h2>
          <ModelSelector
            modelId={await getGatewayModel(await requireRequestScope())}
          />
        </section>
      );
  }
  return null;
}

async function AccountPlan({ userId }: { readonly userId: string }) {
  if (env.ZOEN_BILLING_MODE === "free-beta") {
    const { t } = await getI18n();
    return (
      <section className={styles.sectionCard} aria-labelledby="beta-plan">
        <h2 id="beta-plan" className="type-section-title">
          {t("Beta gratuito")}
        </h2>
        <p className="type-supporting-body text-muted-foreground">
          {t(
            "Seu espaço para experimentar o Zoen. Sem cartão e sem cobranças durante o beta."
          )}
        </p>
      </section>
    );
  }
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
