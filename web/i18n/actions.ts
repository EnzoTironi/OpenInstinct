"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { Schema } from "effect";
import { localeCookie, localeSchema } from "./locale";

export async function changeLocale(value: string) {
  const locale = Schema.decodeUnknownSync(localeSchema)(value);
  (await cookies()).set(localeCookie, locale, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
}
