import { renderToStaticMarkup } from "react-dom/server";
import { TRPCClientError } from "@trpc/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserTracePage } from "@db/services/browser-traces";
import type { api } from "@web/trpc/client";

const mocks = vi.hoisted(() => ({
  useInfiniteQuery:
    vi.fn<() => Partial<ReturnType<typeof api.traces.list.useInfiniteQuery>>>(),
}));
vi.mock("@web/trpc/client", () => ({
  api: { traces: { list: { useInfiniteQuery: mocks.useInfiniteQuery } } },
}));

import { TraceHistory } from "./trace-history";

const trace: BrowserTracePage["traces"][number] = {
  sessionId: "session/one",
  task: "Pesquisar opções e comparar os resultados disponíveis",
  status: "success",
  resultMessage: "As opções estão prontas para você revisar.",
  domains: ["example.com", "docs.example.com"],
  startedAt: "2026-09-12T12:00:00.000Z",
  completedAt: "2026-09-12T12:01:30.000Z",
  durationMs: 90_000,
};

describe("browser activity", () => {
  beforeEach(() => {
    mocks.useInfiniteQuery.mockReset().mockReturnValue({
      data: { pageParams: [null], pages: [{ traces: [], nextCursor: null }] },
      isLoading: false,
      isFetching: false,
      error: null,
    });
  });

  it("keeps the empty state visible during a background refresh", () => {
    mocks.useInfiniteQuery.mockReturnValue({
      data: { pageParams: [null], pages: [{ traces: [], nextCursor: null }] },
      isLoading: false,
      isFetching: true,
    });
    const html = renderToStaticMarkup(<TraceHistory />);
    expect(html).toContain("Tudo começa com uma conversa.");
    expect(html).toContain('href="/chat"');
    expect(html).not.toContain("Carregando atividade");
    expect(html).not.toContain("<table");
  });

  it("does not present a failed request as empty history", () => {
    mocks.useInfiniteQuery.mockReturnValue({
      error: new TRPCClientError("Falha ao carregar"),
      isLoading: false,
    });
    const html = renderToStaticMarkup(<TraceHistory />);
    expect(html).toContain("Falha ao carregar");
    expect(html).not.toContain("Tudo começa com uma conversa.");
  });

  it("retains results and deduplicates paginated activities in accessible links", () => {
    mocks.useInfiniteQuery.mockReturnValue({
      data: {
        pageParams: [null, null],
        pages: [
          { traces: [trace], nextCursor: null },
          { traces: [trace], nextCursor: null },
        ],
      },
      hasNextPage: true,
    });
    const html = renderToStaticMarkup(<TraceHistory />);
    expect(html.match(/href="\/tasks\/session%2Fone"/g)).toHaveLength(1);
    for (const value of [
      trace.task,
      trace.resultMessage,
      "Concluída",
      "1m 30s",
      "docs.example.com",
      "Ver mais atividades",
    ])
      expect(html).toContain(value);
    expect(html).not.toContain("<table");
  });
});
