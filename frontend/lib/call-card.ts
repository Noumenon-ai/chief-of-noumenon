// Call cards are plain data. Only a validated, normalized number may enter a tel URL.
export function normalizeCallNumber(value: unknown): string | null {
  if (!validCallText(value, 64) || !/^\+?[0-9 ().-]+$/.test(value)) return null;
  const number = value.replace(/[ ().-]/g, "");
  return /^\+?[0-9]{7,15}$/.test(number) ? number : null;
}

export function callHref(value: unknown): string | null {
  const number = normalizeCallNumber(value);
  // Events must already contain the server's normalized form. Fail closed on stale or malformed data.
  return number !== null && number === value ? `tel:${number}` : null;
}

export function formatCallNumber(number: string): string {
  if (/^\+1[0-9]{10}$/.test(number)) return number.replace(/^(\+1)([0-9]{3})([0-9]{3})([0-9]{4})$/, "$1 ($2) $3-$4");
  return number;
}

export function validCallText(value: unknown, limit: number, required = true): value is string {
  return typeof value === "string" && Array.from(value).length <= limit && (!required || value.trim().length > 0)
    && !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value);
}

export function validCallPayload(data: Record<string, unknown>): boolean {
  return validCallText(data.name, 80) && validCallText(data.purpose, 200)
    && validCallText(data.phone_number, 64)
    && Array.isArray(data.talking_points) && data.talking_points.length >= 1 && data.talking_points.length <= 6
    && data.talking_points.every(point => validCallText(point, 160))
    && (data.details === undefined || validCallText(data.details, 300, false));
}
