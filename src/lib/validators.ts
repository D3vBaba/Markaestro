export function asString(v: unknown, fallback = '') {
  return typeof v === 'string' ? v.trim() : fallback;
}

export function asBool(v: unknown, fallback = false) {
  return typeof v === 'boolean' ? v : fallback;
}

export function asArrayOfStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean);
}

export function assertRequired(value: string, field: string) {
  if (!value) throw new Error(`VALIDATION_${field.toUpperCase()}_REQUIRED`);
}
