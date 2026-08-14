/** User identity + role. Returned by /auth/login, /auth/refresh and /me/profile. */

export const ROLES = ['admin', 'member'] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export interface Profile {
  id: string;
  email: string;
  fullName: string | null;
  role: Role;
  isActive: boolean;
  onboarded: boolean;
  /** ISO-8601 UTC. */
  createdAt: string;
}

/** PATCH /me/profile — every field optional, at least one required. */
export interface UpdateProfileRequest {
  fullName?: string;
  onboarded?: boolean;
}

export function isAdmin(profile: Pick<Profile, 'role'> | null | undefined): boolean {
  return profile?.role === 'admin';
}

/** "Alex Ivanov" -> "Alex"; falls back to the local part of the email. */
export function firstName(profile: Pick<Profile, 'fullName' | 'email'> | null | undefined): string {
  const full = profile?.fullName?.trim();
  if (full) return full.split(/\s+/)[0]!;
  const local = profile?.email?.split('@')[0];
  return local && local.length > 0 ? local : 'there';
}
