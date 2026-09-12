import { billingPlanCatalog, type BillingPlanId } from "@shared/billing/plans";

export const marketingPlanCopy = {
  free: {
    id: billingPlanCatalog.free.id,
    name: billingPlanCatalog.free.name,
    tagline: "Companion pessoal, com cotas de uso justo.",
    cadence: "Para sempre",
    priceSuffix: "",
    features: [
      "Canais Telegram e WhatsApp",
      "Espaço de trabalho pessoal",
      "Cotas de uso justo (Release 1)",
      "Sem cartão",
    ],
  },
  pro: {
    id: billingPlanCatalog.pro.id,
    name: billingPlanCatalog.pro.name,
    tagline: "Mais cota pessoal para o ritmo do dia a dia.",
    cadence: "Cobrado por mês",
    priceSuffix: "/ mês",
    features: [
      "Tudo do Free",
      "Mais tokens e chamadas de ferramenta por dia",
      "Mais armazenamento e tempo de sandbox",
      "Cobrança no Stripe Customer Portal",
    ],
  },
  org: {
    id: billingPlanCatalog.org.id,
    name: billingPlanCatalog.org.name,
    tagline: "Companion por assento para times e profissionais.",
    cadence: "Por assento, ao mês",
    priceSuffix: "/ assento · mês",
    features: [
      "Tudo do Pro, por assento",
      "Workspaces da organização e RBAC",
      "Quantidade de assentos na assinatura",
      "Admin gerencia assentos no Portal",
    ],
  },
} as const satisfies Record<
  BillingPlanId,
  {
    id: BillingPlanId;
    name: string;
    tagline: string;
    cadence: string;
    priceSuffix: string;
    features: readonly string[];
  }
>;

export const marketingPlanOrder = [
  marketingPlanCopy.free,
  marketingPlanCopy.pro,
  marketingPlanCopy.org,
] as const;

export function marketingPriceLabel(
  planId: BillingPlanId,
  amount: number
): string {
  switch (planId) {
    case "free":
      return "US$ 0";
    case "pro":
      return `US$ ${String(amount)}`;
    case "org":
      return `US$ ${String(amount)}`;
    default:
      return unreachablePlan(planId);
  }
}

function unreachablePlan(planId: never): never {
  throw new Error(`Unexpected billing plan: ${JSON.stringify(planId)}`);
}
