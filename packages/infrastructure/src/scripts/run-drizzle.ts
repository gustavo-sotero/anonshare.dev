import { existsSync, readdirSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate as migrateDb } from 'drizzle-orm/bun-sql/migrator';
import { deriveLocalPlatformEnv } from '../config/index';
import { createDb } from '../db/client';
import { logger } from '../logger/index';

const SUPPORTED_COMMANDS = new Set(['generate', 'migrate']);
const codeExtensionSet = new Set(['.ts', '.js']);
const migrationExtensionSet = new Set(['.sql', '.ts', '.js']);

function hasFiles(dirPath: string, extensions: ReadonlySet<string>): boolean {
  if (!existsSync(dirPath)) {
    return false;
  }

  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = resolve(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (hasFiles(entryPath, extensions)) {
        return true;
      }

      continue;
    }

    if (extensions.has(extname(entry.name))) {
      return true;
    }
  }

  return false;
}

async function runDrizzle(command: string, packageRoot: string): Promise<void> {
  const cliPath = resolve(packageRoot, 'node_modules', 'drizzle-kit', 'bin.cjs');

  const child = Bun.spawn([process.execPath, cliPath, command, ...process.argv.slice(3)], {
    cwd: packageRoot,
    env: process.env,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit'
  });

  const exitCode = await child.exited;

  if (exitCode !== 0) {
    throw new Error(`drizzle-kit ${command} exited with code ${exitCode}`);
  }
}

async function runMigrate(migrationsDir: string): Promise<void> {
  const db = createDb();
  await migrateDb(db, { migrationsFolder: migrationsDir });
}

const command = process.argv[2];

if (!command || !SUPPORTED_COMMANDS.has(command)) {
  throw new Error('[db] Expected one of: generate, migrate.');
}

deriveLocalPlatformEnv();

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const schemaDir = resolve(packageRoot, 'src', 'db', 'schema');
const migrationsDir = resolve(packageRoot, 'src', 'db', 'migrations');

if (command === 'generate' && !hasFiles(schemaDir, codeExtensionSet)) {
  logger.info('Skipping drizzle generate because no schema files exist yet', {
    actor: 'system',
    event: 'db_generate_skipped',
    outcome: 'success'
  });
  process.exit(0);
}

if (command === 'migrate' && !hasFiles(migrationsDir, migrationExtensionSet)) {
  logger.info('Skipping drizzle migrate because no migration files exist yet', {
    actor: 'system',
    event: 'db_migrate_skipped',
    outcome: 'success'
  });
  process.exit(0);
}

if (command === 'migrate') {
  await runMigrate(migrationsDir);
  process.exit(0);
}

await runDrizzle(command, packageRoot);
