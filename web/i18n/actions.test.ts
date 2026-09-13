import { beforeEach, expect, it, vi } from "vitest";
import { changeLocale } from "./actions";

const cookie = vi.hoisted(() => ({ set: vi.fn<() => void>() }));
const revalidate = vi.hoisted(() => vi.fn<() => void>());
vi.mock("next/headers", () => ({ cookies: async () => cookie }));
vi.mock("next/cache", () => ({ revalidatePath: revalidate }));
beforeEach(() => vi.clearAllMocks());

it("persists the locale for server rendering and invalidates prefetched copy", async () => {
  await changeLocale("es");
  expect(cookie.set).toHaveBeenCalledWith(
    "zoen-locale",
    "es",
    expect.objectContaining({
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      maxAge: 31_536_000,
    })
  );
  expect(revalidate).toHaveBeenCalledWith("/", "layout");
});

it("rejects an unsupported preference before changing cookies or cached pages", async () => {
  await expect(changeLocale("../../en")).rejects.toThrow(/pt-BR/);
  expect(cookie.set).not.toHaveBeenCalled();
  expect(revalidate).not.toHaveBeenCalled();
});
