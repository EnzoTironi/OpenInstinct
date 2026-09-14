const periods = [
  { hour: 0, sky: "midnight", greeting: "Boa noite." },
  { hour: 5, sky: "predawn", greeting: "Bom dia." },
  { hour: 6, sky: "dawn", greeting: "Bom dia." },
  { hour: 8, sky: "day", greeting: "Bom dia." },
  { hour: 12, sky: "day", greeting: "Boa tarde." },
  { hour: 16, sky: "sunset", greeting: "Boa tarde." },
  { hour: 18, sky: "dusk", greeting: "Boa noite." },
  { hour: 20, sky: "midnight", greeting: "Boa noite." },
] as const;

export const skyPhases = [...new Set(periods.map((period) => period.sky))];

export function getLocalDay(date: Date | undefined) {
  const hour = date?.getHours() ?? 0;
  const period = periods.findLast((item) => item.hour <= hour) ?? periods[0];
  return {
    sky: period.sky,
    greeting: date ? period.greeting : "Um respiro no dia.",
  };
}
