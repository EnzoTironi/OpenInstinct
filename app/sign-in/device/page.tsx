import Image from "next/image";
import { OnboardingShell } from "@web/auth/onboarding/shell";
import { cn } from "@web/components/class-names";
import styles from "@web/auth/onboarding/onboarding.module.css";
import { getI18n } from "@web/i18n/server";
import type { Metadata } from "next";
import { Schema } from "effect";
import { deviceRequestSchema } from "@shared/identity/channel-auth";
import { NativeDeviceForm } from "@web/auth/channel/device";
import { DeviceSignInUnavailable } from "./_components/unavailable";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t("Sign in | Zoen"),
    description: t("Finish Zoen sign-in on this browser."),
  };
}

export default async function DeviceSignInPage({
  searchParams,
}: PageProps<"/sign-in/device">) {
  const { t } = await getI18n();
  const params = await searchParams;
  if (
    !Schema.is(deviceRequestSchema)({ id: params.id, purpose: params.purpose })
  )
    return <DeviceSignInUnavailable />;
  const { id, purpose } = Schema.decodeUnknownSync(deviceRequestSchema)({
    id: params.id,
    purpose: params.purpose,
  });
  return (
    <OnboardingShell>
      <section className={cn(styles.card, styles.deviceCard)}>
        <div className={styles.deviceScene}>
          <Image
            alt=""
            src="/marketing/panel/zoen-integration.png"
            fill
            unoptimized
            sizes="440px"
          />
        </div>
        <h1 className="type-page-title">
          {purpose === "link"
            ? t("Confirm your account association")
            : t("Sign in to this browser")}
        </h1>
        <NativeDeviceForm id={id} purpose={purpose} />
      </section>
    </OnboardingShell>
  );
}
