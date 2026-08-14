/**
 * Admin CLI — this is how the first admin exists at all, and how teammates are
 * added without any database UI.
 *
 *   npm run create-user -- --email you@company.com --password temp1234 --name "Your Name" --admin
 */

import { createPool } from '../db.js';
import { loadEnv } from '../env.js';
import { createUser } from '../services/users.js';

interface Args {
  email?: string;
  password?: string;
  name?: string;
  admin: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { admin: false, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    switch (token) {
      case '--email':
        args.email = argv[++i];
        break;
      case '--password':
        args.password = argv[++i];
        break;
      case '--name':
        args.name = argv[++i];
        break;
      case '--admin':
        args.admin = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        if (token !== undefined && token.startsWith('--')) {
          console.error(`Unknown option: ${token}`);
          args.help = true;
        }
    }
  }

  return args;
}

const USAGE = `
Create a Whisper user.

  npm run create-user -- --email <email> --password <password> [--name "Full Name"] [--admin]

Options:
  --email     Required. Sign-in address.
  --password  Required. Temporary password, at least 8 characters. Hand it over
              out of band; there is no password-reset email.
  --name      Optional display name.
  --admin     Create with the admin role instead of member.

The user's settings row is created at the same time, in the same transaction.
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.email === undefined || args.password === undefined) {
    console.log(USAGE);
    process.exit(args.help ? 0 : 1);
  }

  const env = loadEnv();
  const pool = createPool(env);

  try {
    const user = await createUser(pool, {
      email: args.email,
      password: args.password,
      fullName: args.name ?? null,
      role: args.admin ? 'admin' : 'member',
    });

    console.log('');
    console.log(`  Created ${user.role}: ${user.email}`);
    if (user.fullName !== null) console.log(`  Name:    ${user.fullName}`);
    console.log(`  Id:      ${user.id}`);
    console.log('');
    console.log('  They can sign in with that email and the password you set.');
    console.log('');
  } catch (error) {
    console.error(`\n  Could not create the user: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
