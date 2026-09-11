import { headers } from "next/headers";

import { readPersonalProfile } from "../../../server/personal-memory/profile";
import { serverRuntime } from "../../../server/runtime";
import { PersonalInfoForm } from "./_components/personal-info-form";

export default async function Page() {
  const profile = await serverRuntime.runPromise(
    readPersonalProfile(await headers())
  );

  return <PersonalInfoForm initialProfile={profile} />;
}
