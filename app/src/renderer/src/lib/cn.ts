/**
 * Conditional class names. Deliberately not clsx — this is the entire feature
 * set we use, and a UI-only dependency is a dependency to keep updated.
 */
export type ClassValue = string | number | false | null | undefined | ClassValue[];

export function cn(...values: ClassValue[]): string {
  const out: string[] = [];

  for (const value of values) {
    if (value === null || value === undefined || value === false || value === '') continue;
    if (Array.isArray(value)) {
      const nested = cn(...value);
      if (nested !== '') out.push(nested);
    } else {
      out.push(String(value));
    }
  }

  return out.join(' ');
}
