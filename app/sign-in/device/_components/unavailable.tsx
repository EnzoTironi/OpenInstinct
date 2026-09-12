import Link from "next/link";
import { Button } from "@web/components/ui/button";

export function DeviceSignInUnavailable() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-8 text-foreground">
      <section className="w-full max-w-sm space-y-6">
        <div className="space-y-2">
          <h1 className="type-page-title">This sign-in link is not valid</h1>
          <p className="type-supporting-body text-muted-foreground">
            This page needs a sign-in request from Companion. Start again in
            this browser, then confirm the new request in your messenger.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Button nativeButton={false} render={<Link href="/sign-in" />}>
            Sign in
          </Button>
          <Button
            nativeButton={false}
            render={<Link href="/get-started" />}
            variant="outline"
          >
            Get started
          </Button>
        </div>
      </section>
    </main>
  );
}
