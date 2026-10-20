/** Date-only business fields use the configured business calendar. */
export function localDate(date = new Date()): string {
  const timeZone = import.meta.env.VITE_BUSINESS_TIME_ZONE || "Asia/Kolkata";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  const year = value("year"), month = value("month"), day = value("day");
  if (!year || !month || !day) throw new Error(`Unable to format date in ${timeZone}.`);
  return `${year}-${month}-${day}`;
}
