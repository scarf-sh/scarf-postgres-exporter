export type RangePlan =
  | { skip: true }
  | { skip: false; start: string; end: string };

// Given the last imported date (YYYY-MM-DD) and yesterday (YYYY-MM-DD),
// decide whether to skip or which range to fetch (inclusive of both ends).
export function computeRange(lastImportedDate: string, yesterday: string): RangePlan {
  // If we've already imported yesterday or anything later (incl. today), skip.
  if (lastImportedDate >= yesterday) {
    return { skip: true };
  }

  // Compute the day after the last imported date.
  const start = dayAfter(lastImportedDate);
  const end = yesterday;

  if (start > end) {
    return { skip: true };
  }

  return { skip: false, start, end };
}

function formatDate(d: Date) {
  let month = "" + (d.getMonth() + 1);
  let day = "" + d.getDate();
  const year = d.getFullYear();
  if (month.length < 2) month = "0" + month;
  if (day.length < 2) day = "0" + day;
  return [year, month, day].join("-");
}

// Returns the date string (YYYY-MM-DD) for the day after the given date-only string.
// Accepts a date-only string (YYYY-MM-DD) and anchors it to midnight UTC internally
// to avoid callers needing to append a time component.
export function dayAfter(dateOnly: string): string {
  const d = new Date(dateOnly + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return formatDate(d);
}
