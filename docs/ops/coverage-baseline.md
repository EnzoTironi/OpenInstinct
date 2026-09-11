# Coverage baseline (NASA campaign)

Generated: 2026-09-11 (America/Sao_Paulo) on branch `test/nasa-battery` @ `ref: refs/heads/test/nasa-battery`.

Command: `pnpm test:coverage:report` (v8, scoped include from `vitest.config.ts`, thresholds disabled for reporting).

## Overall (scoped production source)

| Metric     | Coverage            |
| ---------- | ------------------- |
| Statements | 43.57% (4652/10676) |
| Branches   | 38.47% (2007/5217)  |
| Functions  | 37.8% (1160/3068)   |
| Lines      | 44.53% (4373/9820)  |

**Gate target:** 100% on all four metrics via `pnpm test:coverage`.

## By top-level package

| Package | Lines | Functions | Branches | Statements |
| --- | --- | --- | --- | --- |
| agent/ | 53.55% (1402/2618) | 50.19% (390/777) | 45.74% (666/1456) | 52.16% (1483/2843) |
| app/ | 24.69% (579/2345) | 21.98% (180/819) | 23.34% (345/1478) | 24.10% (625/2593) |
| db/ | 76.80% (586/763) | 73.49% (219/298) | 67.05% (236/352) | 75.94% (625/823) |
| server/ | 38.92% (1259/3235) | 24.14% (217/899) | 31.33% (448/1430) | 38.36% (1336/3483) |
| shared/ | 90.89% (359/395) | 95.24% (100/105) | 79.92% (203/254) | 88.43% (382/432) |
| tools/ | 100.00% (3/3) | 100.00% (1/1) | 100.00% (2/2) | 100.00% (3/3) |
| web/ | 40.13% (185/461) | 31.36% (53/169) | 43.67% (107/245) | 39.68% (198/499) |

## Largest gaps (files with >20 lines, lowest line %)

| File | Lines | Funcs | Branches | Stmts | Uncovered lines |
| --- | --- | --- | --- | --- | --- |
| `app/(authenticated)/chat/[sessionId]/_components/use-session-agent.ts` | 0% | 0% | 0% | 0% | 167 |
| `agent/subagents/browser-agent/tools/semantic_browser.ts` | 0% | 0% | 0% | 0% | 110 |
| `agent/lib/channel-session.ts` | 0% | 0% | 0% | 0% | 100 |
| `app/(marketing)/pricing/_components/pricing-panel.tsx` | 0% | 0% | 0% | 0% | 81 |
| `server/billing/checkout.ts` | 0% | 0% | 0% | 0% | 75 |
| `app/(authenticated)/vault/_components/logins/import.tsx` | 0% | 0% | 0% | 0% | 70 |
| `app/(authenticated)/vault/_components/cards/form.tsx` | 0% | 0% | 0% | 0% | 64 |
| `app/(authenticated)/chat/[sessionId]/_components/activity/index.tsx` | 0% | 0% | 0% | 0% | 62 |
| `app/(authenticated)/vault/_components/logins/form.tsx` | 0% | 0% | 0% | 0% | 60 |
| `app/(authenticated)/vault/_components/logins/parse-chrome-passwords.ts` | 0% | 0% | 0% | 0% | 60 |
| `app/(authenticated)/account/_components/billing-section.tsx` | 0% | 0% | 0% | 0% | 57 |
| `app/(authenticated)/vault/_components/section.tsx` | 0% | 0% | 0% | 0% | 54 |
| `app/(authenticated)/account/_components/privacy-wipe-section.tsx` | 0% | 0% | 0% | 0% | 50 |
| `app/(authenticated)/tasks/(overview)/_components/trace-history.tsx` | 0% | 0% | 0% | 0% | 46 |
| `app/(authenticated)/chat/[sessionId]/_components/activity/use-session-history.ts` | 0% | 0% | 0% | 0% | 45 |
| `app/api/google-workspace/connect/route.ts` | 0% | 0% | 0% | 0% | 43 |
| `app/(authenticated)/(workspace)/_components/model-selector.tsx` | 0% | 0% | 0% | 0% | 42 |
| `app/_components/og-mark.tsx` | 0% | 0% | 0% | 0% | 42 |
| `web/auth/channel/device.tsx` | 0% | 0% | 0% | 0% | 39 |
| `app/(authenticated)/chat/[sessionId]/_components/activity/trace.tsx` | 0% | 0% | 0% | 0% | 38 |
| `app/(authenticated)/chat/[sessionId]/_components/input/index.tsx` | 0% | 0% | 0% | 0% | 38 |
| `agent/lib/private-channel.ts` | 0% | 0% | 0% | 0% | 37 |
| `app/(authenticated)/account/linked-channels.tsx` | 0% | 0% | 0% | 0% | 37 |
| `app/(authenticated)/vault/_components/logins/parse-csv.ts` | 0% | 0% | 0% | 0% | 34 |
| `app/(authenticated)/vault/_components/addresses/form.tsx` | 0% | 0% | 0% | 0% | 32 |

## Notes

- `test:app` currently has **5 failing files / 6 failing tests** on this tip (mostly anti-slop `vi.fn` / source-text contracts / one timeout). They predate the coverage harness; NASA fill work must migrate those seams to Layers/`it.effect` rather than reintroduce `vi.mock`.
- Runtime suite (`test:runtime`) is separate and not included in this unit coverage percentage.
- Full HTML report is local-only under `coverage/` (gitignored). Re-run `pnpm test:coverage:report` to refresh.
