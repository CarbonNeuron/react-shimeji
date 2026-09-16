/**
 * Publish script for react-shimeji monorepo.
 * 
 * For each package under packages/:
 *   1. Checks if name@version already exists on npm
 *   2. Skips if already published
 *   3. Publishes if new or version bumped
 * 
 * Publishes in dependency order: core → react → character-* → characters (umbrella)
 */

import { execSync } from "child_process";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

const PACKAGES_DIR = join(import.meta.dirname!, "..", "packages");

interface PkgMeta {
  dir: string;
  name: string;
  version: string;
  json: Record<string, unknown>;
}

function loadPackage(dirName: string): PkgMeta | null {
  const dir = join(PACKAGES_DIR, dirName);
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return null;
  const json = JSON.parse(readFileSync(pkgPath, "utf-8"));
  return { dir, name: json.name, version: json.version, json };
}

function isPublished(name: string, version: string): boolean {
  try {
    execSync(`npm view ${name}@${version} version 2>/dev/null`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function resolveWorkspaceDeps(pkg: PkgMeta, allPackages: Map<string, PkgMeta>): void {
  // Replace workspace:* references with actual versions for npm publish
  for (const depType of ["dependencies", "peerDependencies"] as const) {
    const deps = pkg.json[depType] as Record<string, string> | undefined;
    if (!deps) continue;
    for (const [name, version] of Object.entries(deps)) {
      if (version.startsWith("workspace:")) {
        const resolved = allPackages.get(name);
        if (resolved) {
          deps[name] = resolved.version;
        }
      }
    }
  }
  // Write back the resolved package.json for publish
  const { writeFileSync } = require("fs");
  writeFileSync(join(pkg.dir, "package.json"), JSON.stringify(pkg.json, null, 2) + "\n");
}

function publish(pkg: PkgMeta): boolean {
  try {
    console.log(`  📦 Publishing ${pkg.name}@${pkg.version}...`);
    execSync(`npm publish --access public --tag latest`, {
      cwd: pkg.dir,
      stdio: "inherit",
    });
    return true;
  } catch (e) {
    console.error(`  ❌ Failed to publish ${pkg.name}@${pkg.version}`);
    console.error(e);
    return false;
  }
}

// Discover all packages
const dirs = readdirSync(PACKAGES_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

const packages: PkgMeta[] = dirs
  .map(d => loadPackage(d))
  .filter((p): p is PkgMeta => p !== null);

// Sort into publish order: core first, react second, character-* next, characters (umbrella) last
const order = (pkg: PkgMeta): number => {
  if (pkg.name === "@react-shimeji/core") return 0;
  if (pkg.name === "@react-shimeji/react") return 1;
  if (pkg.name === "@react-shimeji/characters") return 3;
  return 2; // character-*
};

packages.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));

console.log(`Found ${packages.length} packages\n`);

// Build a lookup map for workspace:* resolution
const pkgMap = new Map<string, PkgMeta>(packages.map(p => [p.name, p]));

let published = 0;
let skipped = 0;
let failed = 0;

for (const pkg of packages) {
  if (isPublished(pkg.name, pkg.version)) {
    skipped++;
    continue;
  }
  // Resolve workspace:* deps to real versions before publishing
  resolveWorkspaceDeps(pkg, pkgMap);
  if (publish(pkg)) {
    published++;
  } else {
    failed++;
  }
}

console.log(`\n✅ Published: ${published} | ⏭️ Skipped (already published): ${skipped} | ❌ Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
