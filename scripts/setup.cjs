#!/usr/bin/env node
// One-command local setup: `npm run setup` (add `-- --seed` to force loading demo data).
//
// 1. Creates .env from .env.example if it is missing (then stops so you can edit it).
// 2. Creates the database named in DATABASE_URL if it does not exist.
// 3. Runs the migrations (safe to repeat).
// 4. Loads the demo dataset only if the database has no users yet, or with --seed.
//    It never seeds a database that already contains data unless --seed is given.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
const forceSeed = process.argv.includes('--seed');

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

function runTsx(script) {
  const cli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const result = spawnSync(process.execPath, [cli, script], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) fail(`${script} failed (exit ${result.status}).`);
}

async function main() {
  if (!fs.existsSync(path.join(root, 'node_modules', 'pg'))) fail('Dependencies missing — run `npm install` first.');

  if (!fs.existsSync(envPath)) {
    fs.copyFileSync(path.join(root, '.env.example'), envPath);
    fail('Created .env from .env.example. Edit DATABASE_URL and JWT_SECRET in .env, then run `npm run setup` again.');
  }
  require('dotenv').config({ path: envPath, quiet: true });
  const { DATABASE_URL, JWT_SECRET } = process.env;
  if (!DATABASE_URL || DATABASE_URL.includes('CHANGE_ME')) fail('Set DATABASE_URL in .env first.');
  if (!JWT_SECRET || JWT_SECRET.includes('CHANGE_ME')) fail('Set JWT_SECRET in .env to a long random string first.');

  const { Client } = require('pg');
  const target = new URL(DATABASE_URL);
  const dbName = decodeURIComponent(target.pathname.replace(/^\//, ''));
  if (!/^[A-Za-z0-9_]+$/.test(dbName)) fail(`Unsupported database name "${dbName}" (use letters, digits and _).`);

  // Connect to the server's maintenance database to create ours if needed.
  const admin = new URL(DATABASE_URL);
  admin.pathname = '/postgres';
  const adminClient = new Client({ connectionString: admin.toString() });
  try {
    await adminClient.connect();
  } catch (e) {
    fail(`Cannot reach PostgreSQL at ${target.host}: ${e.message}`);
  }
  const exists = (await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])).rowCount > 0;
  if (!exists) {
    await adminClient.query(`CREATE DATABASE "${dbName}"`);
    console.log(`✔ Created database ${dbName}`);
  } else {
    console.log(`✔ Database ${dbName} exists`);
  }
  await adminClient.end();

  console.log('→ Running migrations…');
  runTsx('apps/api/src/db/migrate.ts');

  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  const users = Number((await db.query('SELECT COUNT(*) AS n FROM users')).rows[0].n);
  await db.end();

  if (users === 0 || forceSeed) {
    console.log('→ Loading demo data…');
    runTsx('apps/api/src/db/seed.ts');
  } else {
    console.log(`✔ Database already has ${users} users — demo data not loaded (use \`npm run setup -- --seed\` to force).`);
  }
  console.log('\nSetup complete. Start the app with `npm run dev` and open http://localhost:5000');
}

main().catch(e => fail(e.stack || String(e)));
