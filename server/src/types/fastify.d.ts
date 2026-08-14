import 'fastify';

import type { Role } from '@whisper/shared';

/**
 * The authenticated caller, attached by the auth hook.
 *
 * These are primitives on purpose. Fastify 5 prohibits decorating a request
 * with a reference type (object/array) because the same reference would be
 * shared across every request; primitive decorators are still allowed.
 *
 * The `import 'fastify'` above is required — without it this file is a script
 * rather than a module, and `declare module` becomes a redeclaration instead of
 * a merge.
 */
declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
    role: Role;
  }
}
