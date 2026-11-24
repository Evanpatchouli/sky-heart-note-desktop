export function CNDateToDateString(date?: string) {
  return date?.replace(/年|月/g, "-").replace(/日/g, "") || "";
}

export function bookingDates(date?: string): [string, string] {
  const parts = date?.match(/\d{4}(?:年\d{1,2}月\d{1,2}日|-\d{1,2}-\d{1,2})/g);
  return [parts?.[0] || "", parts?.[1] || ""];
}

export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
