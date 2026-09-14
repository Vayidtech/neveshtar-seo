#!/usr/bin/env node
/**
 * Run a command with `.grok/app-env.json` merged into its environment.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { constants as osConstants } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const APP_ENV_REL_PATH = ".grok/app-env.json";
const VITE_PREFIX = "VITE_";

export function parseAppEnv(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const env = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!key.startsWith(VITE_PREFIX)) continue;
    if (typeof value !== "string") continue;
    env[key] = value;
  }
  return env;
}

export function readAppEnv(root) {
  try {
    return parseAppEnv(readFileSync(join(root, APP_ENV_REL_PATH), "utf8"));
  } catch {
    return {};
  }
}

export function mergeAppEnv(appEnv, processEnv) {
  return { ...appEnv, ...processEnv };
}

export function exitStatusFromChild(code, signal) {
  if (signal) {
    const signo = osConstants.signals[signal];
    return 128 + (typeof signo === "number" ? signo : 1);
  }
  return typeof code === "number" ? code : 1;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const appEnv = readAppEnv(root);
const env = mergeAppEnv(appEnv, process.env);

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: with-app-env.mjs <command> [args...]");
  process.exit(1);
}

const child = spawn(args[0], args.slice(1), {
  env,
  stdio: "inherit",
  shell: false,
});

child.on("exit", (code, signal) => {
  process.exit(exitStatusFromChild(code, signal));
});

child.on("error", (err) => {
  console.error(err);
  process.exit(1);
});
