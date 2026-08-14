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

/** PATCH /admin/users/:id — activate / deactivate. */
export interface UpdateUserRequest {
  isActive: boolean;
}

/** The updated user, returned bare. */
export type UpdateUserResponse = AdminUser;

export const MIN_PASSWORD_LENGTH = 8;
