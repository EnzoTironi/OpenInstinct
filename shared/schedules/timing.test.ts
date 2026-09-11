import {
  computeLatestRun,
  computeNextRun,
  scheduleTimingSchema,
} from "@shared/schedules/timing";
import { describe, expect, it } from "vitest";

describe("schedule timing", () => {
  it("finds the latest elapsed interval without walking every occurrence", () => {
    expect(
      computeLatestRun(
        {
          anchoredAt: "2026-09-01T13:00:00.000Z",
          everyMinutes: 60,
          kind: "interval",
        },
        new Date("2026-09-08T13:30:00.000Z")
      )
    ).toEqual(new Date("2026-09-08T13:00:00.000Z"));
  });

  it("keeps calendar recurrence at the same local time across DST", () => {
    const timing = {
      frequency: "daily" as const,
      kind: "calendar" as const,
      localTime: "09:00",
      timezone: "America/New_York",
    };

    expect(
      computeNextRun(
        timing,
        new Date("2026-10-31T14:00:00.000Z")
      )?.toISOString()
    ).toBe("2026-11-01T14:00:00.000Z");
    expect(
      computeNextRun(
        timing,
        new Date("2026-11-01T15:00:00.000Z")
      )?.toISOString()
    ).toBe("2026-11-02T14:00:00.000Z");
  });

  it("anchors intervals instead of drifting from completion time", () => {
    expect(
      computeNextRun(
        {
          anchoredAt: "2026-09-01T12:00:00.000Z",
          everyMinutes: 60,
          kind: "interval",
        },
        new Date("2026-09-01T13:07:00.000Z")
      )?.toISOString()
    ).toBe("2026-09-01T14:00:00.000Z");
  });

  it("requires a weekday for weekly calendar recurrence", () => {
    expect(
      scheduleTimingSchema.safeParse({
        frequency: "weekly",
        kind: "calendar",
        localTime: "09:00",
        timezone: "America/New_York",
      }).success
    ).toBe(false);
  });
});

it("does return a one-shot run only when it is still in the future", () => {
  const timing = {
    at: "2026-09-15T12:00:00.000Z",
    kind: "once" as const,
  };

  expect(
    computeNextRun(timing, new Date("2026-09-15T11:00:00.000Z"))?.toISOString()
  ).toBe("2026-09-15T12:00:00.000Z");
  expect(
    computeNextRun(timing, new Date("2026-09-15T12:00:00.000Z"))
  ).toBeNull();
});

it("does return the one-shot as latest only after it has elapsed", () => {
  const timing = {
    at: "2026-09-15T12:00:00.000Z",
    kind: "once" as const,
  };

  expect(
    computeLatestRun(timing, new Date("2026-09-15T11:59:59.000Z"))
  ).toBeNull();
  expect(
    computeLatestRun(
      timing,
      new Date("2026-09-15T12:00:00.000Z")
    )?.toISOString()
  ).toBe("2026-09-15T12:00:00.000Z");
});

it("does skip weekend days for weekday calendar recurrence", () => {
  const timing = {
    frequency: "weekdays" as const,
    kind: "calendar" as const,
    localTime: "09:00",
    timezone: "America/Sao_Paulo",
  };

  // Friday 2026-09-11 12:00Z is 09:00 BRT; next weekday is Monday.
  expect(
    computeNextRun(timing, new Date("2026-09-11T12:00:00.000Z"))?.toISOString()
  ).toBe("2026-09-14T12:00:00.000Z");
});

it("does find the latest matching calendar occurrence before now", () => {
  const timing = {
    frequency: "weekly" as const,
    kind: "calendar" as const,
    localTime: "09:00",
    timezone: "America/Sao_Paulo",
    weekday: 1,
  };

  expect(
    computeLatestRun(
      timing,
      new Date("2026-09-11T15:00:00.000Z")
    )?.toISOString()
  ).toBe("2026-09-07T12:00:00.000Z");
});

it("does reject an invalid IANA timezone in the timing schema", () => {
  expect(
    scheduleTimingSchema.safeParse({
      frequency: "daily",
      kind: "calendar",
      localTime: "09:00",
      timezone: "Not/AZone",
    }).success
  ).toBe(false);
});

it("does reject an invalid local time string", () => {
  expect(
    scheduleTimingSchema.safeParse({
      frequency: "daily",
      kind: "calendar",
      localTime: "25:00",
      timezone: "UTC",
    }).success
  ).toBe(false);
});

it("does return null for an interval that has not started yet", () => {
  expect(
    computeLatestRun(
      {
        anchoredAt: "2026-09-20T12:00:00.000Z",
        everyMinutes: 30,
        kind: "interval",
      },
      new Date("2026-09-15T12:00:00.000Z")
    )
  ).toBeNull();
});
