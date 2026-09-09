import { describe, expect, it } from "vitest";
import { calendarEventTime } from "../calendar-time";

describe("calendar list event timezone", () => {
  // Actual Google events.list response for the approved Companion demo event.
  // The calendar default is America/Boa_Vista, while the event zone is Sao Paulo.
  const actualStart = {
    dateTime: "2026-09-09T09:00:00-04:00",
    timeZone: "America/Sao_Paulo",
  };
  it("formats the real returned instant as 10:00 Sao Paulo, not 09:00", () => {
    expect(calendarEventTime(actualStart, "America/Sao_Paulo")).toEqual({
      instant: "2026-09-09T13:00:00.000Z",
      timezone: "America/Sao_Paulo",
      display: "09/09/2026, 10:00:00 GMT-03:00",
    });
  });
  it("produces the same display for Google's explicit timezone response", () => {
    expect(
      calendarEventTime(
        {
          dateTime: "2026-09-09T10:00:00-03:00",
          timeZone: "America/Sao_Paulo",
        },
        "America/Sao_Paulo"
      )
    ).toEqual(calendarEventTime(actualStart, "America/Sao_Paulo"));
  });
  it("preserves date-only all-day values without inventing a UTC midnight", () => {
    expect(
      calendarEventTime({ date: "2026-09-09" }, "America/Sao_Paulo")
    ).toEqual({ date: "2026-09-09", allDay: true });
  });
  it("does not invent a time when the provider omits it", () => {
    expect(calendarEventTime(undefined, "America/Sao_Paulo")).toBeNull();
    expect(calendarEventTime({}, "America/Sao_Paulo")).toBeNull();
  });
});
