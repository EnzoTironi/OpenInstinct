import type { calendar_v3 } from "@googleapis/calendar";

/** The RFC3339 offset determines the instant; an event's timeZone may differ
 * from the offset Google used when serializing a calendar-list response.
 */
export function calendarEventTime(
  value: calendar_v3.Schema$EventDateTime | undefined,
  timezone: string
) {
  if (!value) return null;
  if (value.date) return { date: value.date, allDay: true };
  if (!value.dateTime) return null;
  const instant = new Date(value.dateTime);
  const display = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  }).format(instant);
  return { instant: instant.toISOString(), timezone, display };
}
