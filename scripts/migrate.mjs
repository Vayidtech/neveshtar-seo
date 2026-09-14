#!/usr/bin/env node
/** Minimal migrate stub — no-op when database is disabled */
import { existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "migrations");

if (!existsSync(migrationsDir)) {
  console.log("[migrate] no migrations directory — skip");
  process.exit(0);
}

const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
if (files.length === 0) {
  console.log("[migrate] no SQL migrations — skip");
  process.exit(0);
}

console.log("[migrate] migrations present but database disabled in app-env — skip");
process.exit(0);
