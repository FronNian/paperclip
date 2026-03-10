#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";
 
const env = {
  ...process.env,
  PAPERCLIP_MIGRATION_PROMPT: "never",
  PAPERCLIP_MIGRATION_AUTO_APPLY: "true",
};
 
const tsxBin = process.platform === "win32" ? "tsx.cmd" : "tsx";
const args = [
  "watch",
  "--clear-screen=false",
  "--ignore",
  "../node_modules/.vite-temp",
  "--ignore",
  "../node_modules/.vite",
  "--ignore",
  "../ui/node_modules",
  "--ignore",
  "../ui/.vite",
  "--ignore",
  "../ui/dist",
  "src/index.ts",
];
 
const child = spawn(tsxBin, args, {
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});
 
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  if (code === 3221225786) {
    process.exit(0);
    return;
  }
  process.exit(code ?? 0);
});
