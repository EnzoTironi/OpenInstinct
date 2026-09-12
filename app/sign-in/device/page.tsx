import type { Metadata } from "next";
import { Schema } from "effect";
import { deviceRequestSchema } from "@shared/identity/channel-auth";
import { NativeDeviceForm } from "@web/auth/channel/device";
import { DeviceSignInUnavailable } from "./_components/unavailable";

export const metadata: Metadata = {
  title: "Sign in | Companion",
  description: "Finish Companion sign-in on this browser.",
};

export default async function DeviceSignInPage({
  searchParams,
}: PageProps<"/sign-in/device">) {
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
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-8 text-foreground">
      <section className="w-full max-w-sm space-y-6">
        <h1 className="type-page-title">
          {purpose === "link"
            ? "Confirm your account association"
            : "Sign in to this browser"}
        </h1>
        <NativeDeviceForm id={id} purpose={purpose} />
      </section>
    </main>
  );
}
