import type { Profile, Role } from './profile.js';

/** GET /admin/users. Same shape as Profile — admins see nothing extra. */
export type AdminUser = Profile;

export interface AdminUserList {
  users: AdminUser[];
}

/** POST /admin/users — creates the account and its settings row. */
export interface CreateUserRequest {
  email: string;
  /** Temporary password, handed to the teammate out of band. */
  password: string;
  fullName?: string;
  role?: Role;
}

/** The created user, returned bare (201). */
export type CreateUserResponse = AdminUser;

/**
 * PATCH /admin/users/:id — every field optional, at least one required.
 * Admins can fix a typo'd email, hand out a new temporary password, rename,
 * change role, or (de)activate. Changing the password revokes the user's
 * sessions server-side. Self-protection is enforced server-side too: an admin
 * cannot deactivate, demote, or delete their own account.
 */
export interface UpdateUserRequest {
  email?: string;
  /** New temporary password — hashed server-side, sessions revoked. */
  password?: string;
  fullName?: string;
  role?: Role;
  isActive?: boolean;
}

/** The updated user, returned bare. */
export type UpdateUserResponse = AdminUser;

/** DELETE /admin/users/:id — permanent; cascades settings, sessions, tokens. */
export interface DeleteUserResponse {
  deleted: true;
}

export const MIN_PASSWORD_LENGTH = 8;
