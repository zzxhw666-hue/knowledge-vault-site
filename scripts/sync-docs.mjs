import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(root, "dist");
const docsDir = resolve(root, "docs");

await rm(docsDir, { force: true, recursive: true });
await mkdir(docsDir, { recursive: true });
await cp(distDir, docsDir, { recursive: true });
await writeFile(resolve(docsDir, ".nojekyll"), "");

await rm(resolve(root, "assets"), { force: true, recursive: true });
await cp(resolve(distDir, "assets"), resolve(root, "assets"), { recursive: true });
await cp(resolve(distDir, "index.html"), resolve(root, "index.html"));
await cp(resolve(distDir, "supabase-config.js"), resolve(root, "supabase-config.js"));

console.log("Synced dist/ to docs/ and repository root for GitHub Pages.");
