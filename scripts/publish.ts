/**
 * Publish script for react-shimeji monorepo.
 *
 * For each package under packages/:
 *   1. Checks if name@version already exists on npm (in parallel batches)
 *   2. Skips if already published
 *   3. Publishes new/bumped packages (sequentially, 1 at a time)
 *
 * Publishes in dependency order: core → react → character-* → characters (umbrella)
 */

import { execSync, exec } from "child_process";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const PACKAGES_DIR = join(import.meta.dirname!, "..", "packages");
const CHECK_CONCURRENCY = 50; // parallel npm view checks
const PUBLISH_CONCURRENCY = 1; // sequential publishes to avoid npm rate limits

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

function isPublishedAsync(name: string, version: string): Promise<boolean> {
  return new Promise((resolve) => {
    exec(`npm view ${name}@${version} version 2>/dev/null`, (err) => {
      resolve(!err);
    });
  });
}

async function checkPublishedBatch(
  packages: PkgMeta[]
): Promise<Set<string>> {
  const alreadyPublished = new Set<string>();
  // Process in batches of CHECK_CONCURRENCY
  for (let i = 0; i < packages.length; i += CHECK_CONCURRENCY) {
    const batch = packages.slice(i, i + CHECK_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (pkg) => ({
        key: `${pkg.name}@${pkg.version}`,
        published: await isPublishedAsync(pkg.name, pkg.version),
      }))
    );
    for (const r of results) {
      if (r.published) alreadyPublished.add(r.key);
    }
    const checked = Math.min(i + CHECK_CONCURRENCY, packages.length);
    process.stdout.write(
      `\r  Checking registry: ${checked}/${packages.length}`
    );
  }
  console.log("");
  return alreadyPublished;
}

function resolveWorkspaceDeps(
  pkg: PkgMeta,
  allPackages: Map<string, PkgMeta>
): void {
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
  writeFileSync(
    join(pkg.dir, "package.json"),
    JSON.stringify(pkg.json, null, 2) + "\n"
  );
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
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const packages: PkgMeta[] = dirs
  .map((d) => loadPackage(d))
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
const pkgMap = new Map<string, PkgMeta>(packages.map((p) => [p.name, p]));

// Phase 1: Check which packages need publishing (parallel)
console.log("🔍 Scanning npm registry...");
const alreadyPublished = await checkPublishedBatch(packages);

const toPublish = packages.filter(
  (p) => !alreadyPublished.has(`${p.name}@${p.version}`)
);
const skipped = packages.length - toPublish.length;

console.log(
  `\n  ⏭️ ${skipped} already published, ${toPublish.length} to publish\n`
);

if (toPublish.length === 0) {
  console.log("✅ Nothing to publish — all packages up to date!");
  process.exit(0);
}

// Phase 2: Publish (sequentially to avoid npm rate limits)
let published = 0;
let failed = 0;

for (const pkg of toPublish) {
  resolveWorkspaceDeps(pkg, pkgMap);
  if (publish(pkg)) {
    published++;
  } else {
    failed++;
  }
}

console.log(
  `\n✅ Published: ${published} | ⏭️ Skipped (already published): ${skipped} | ❌ Failed: ${failed}`
);

if (failed > 0) {
  process.exit(1);
}
