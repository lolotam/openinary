import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const relativeRoot = process.argv[2] || "test";
const testRoot = join(packageRoot, relativeRoot);

function collectTestFiles(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") return acc;
    throw error;
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTestFiles(full, acc);
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      acc.push(full);
    }
  }
  return acc;
}

const files = collectTestFiles(testRoot);
if (files.length === 0) {
  console.error(`No *.test.ts files found under ${testRoot}`);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", ...files],
  { stdio: "inherit", cwd: packageRoot },
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
