#!/usr/bin/env bun
/**
 * Generates individual npm packages for each shimeji character,
 * plus an umbrella @react-shimeji/characters package that depends on all of them.
 *
 * Each character package exports a LegacyCharacterPack with:
 *   - id: character directory name
 *   - spritesheet: base64 data URI of the spritesheet PNG
 *   - sprites: parsed sprites.json object
 *   - actions: raw actions.xml string
 *   - behaviors: raw behaviors.xml string
 *   - metadata: from configuration.json if available
 */

import { readdir, readFile, writeFile, mkdir, stat } from "fs/promises";
import { join, basename } from "path";
import { existsSync } from "fs";

const SHIMEJI_DIR = process.env.SHIMEJI_SOURCE_DIR ?? join(
  process.env.HOME!,
  "LuciaRetirementCountdown/public/shimeji"
);
const OUTPUT_DIR = join(process.env.HOME!, "react-shimeji/packages");
const SCOPE = "@react-shimeji";

interface CharacterResult {
  dirName: string;
  packageName: string;
  success: boolean;
  error?: string;
  sizeKB?: number;
}

async function getCharacterDirs(): Promise<string[]> {
  const entries = await readdir(SHIMEJI_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function sanitizePackageName(dirName: string): string {
  // npm package names: lowercase, hyphens/dots/underscores, max 214 chars
  return dirName
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 200); // leave room for scope
}

async function generateCharacterPackage(
  dirName: string
): Promise<CharacterResult> {
  const charDir = join(SHIMEJI_DIR, dirName);
  const pkgName = sanitizePackageName(dirName);
  const fullPkgName = `${SCOPE}/character-${pkgName}`;
  const outDir = join(OUTPUT_DIR, `character-${pkgName}`);

  try {
    // Check required files exist
    const spritesheetPath = join(charDir, "spritesheet.png");
    const actionsPath = join(charDir, "actions.xml");
    const behaviorsPath = join(charDir, "behaviors.xml");
    const spritesPath = join(charDir, "sprites.json");

    for (const f of [spritesheetPath, actionsPath, behaviorsPath, spritesPath]) {
      if (!existsSync(f)) {
        return {
          dirName,
          packageName: fullPkgName,
          success: false,
          error: `Missing ${basename(f)}`,
        };
      }
    }

    // Read all files
    const [spritesheetBuf, actionsXml, behaviorsXml, spritesJson] =
      await Promise.all([
        readFile(spritesheetPath),
        readFile(actionsPath, "utf-8"),
        readFile(behaviorsPath, "utf-8"),
        readFile(spritesPath, "utf-8"),
      ]);

    // Read optional configuration.json for metadata
    const configPath = join(charDir, "configuration.json");
    let metadata: Record<string, unknown> | undefined;
    let displayName: string | undefined;
    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(await readFile(configPath, "utf-8"));
        metadata = config.metadata;
        displayName = metadata?.shimejiName as string | undefined;
      } catch {
        // skip bad config
      }
    }

    // Convert spritesheet to base64 data URI
    const b64 = spritesheetBuf.toString("base64");
    const dataUri = `data:image/png;base64,${b64}`;

    // Parse sprites to validate
    const sprites = JSON.parse(spritesJson);

    // Generate the TypeScript source
    // We use JSON.stringify for the data to avoid escaping issues with XML
    const source = `// Auto-generated character package for ${dirName}
// Do not edit manually — regenerate with scripts/generate-character-packages.ts

/** Character specification for ${displayName ?? dirName} */
export const character = {
  id: ${JSON.stringify(dirName)},
${displayName ? `  name: ${JSON.stringify(displayName)},\n` : ""}  spritesheet: ${JSON.stringify(dataUri)},
  sprites: ${JSON.stringify(sprites)},
  actions: ${JSON.stringify(actionsXml)},
  behaviors: ${JSON.stringify(behaviorsXml)},
${metadata ? `  metadata: ${JSON.stringify(metadata)},\n` : ""}} as const;

export default character;
`;

    // Generate package.json
    const packageJson = {
      name: fullPkgName,
      version: "1.0.0",
      description: `Shimeji character pack: ${displayName ?? dirName}`,
      type: "module",
      main: "./index.ts",
      types: "./index.ts",
      exports: {
        ".": "./index.ts",
      },
      keywords: [
        "shimeji",
        "react-shimeji",
        "character",
        dirName,
        ...(displayName ? [displayName] : []),
      ],
      license: "MIT",
      peerDependencies: {
        [`${SCOPE}/core`]: ">=1.0.0",
      },
      peerDependenciesMeta: {
        [`${SCOPE}/core`]: { optional: true },
      },
      repository: {
        type: "git",
        url: "https://github.com/CarbonNeuron/react-shimeji.git",
        directory: `packages/character-${pkgName}`,
      },
    };

    // Write files
    await mkdir(outDir, { recursive: true });
    await Promise.all([
      writeFile(join(outDir, "index.ts"), source),
      writeFile(
        join(outDir, "package.json"),
        JSON.stringify(packageJson, null, 2) + "\n"
      ),
    ]);

    const sizeKB = Math.round(source.length / 1024);

    return { dirName, packageName: fullPkgName, success: true, sizeKB };
  } catch (err) {
    return {
      dirName,
      packageName: fullPkgName,
      success: false,
      error: String(err),
    };
  }
}

async function generateUmbrellaPackage(
  characters: CharacterResult[]
): Promise<void> {
  const successful = characters.filter((c) => c.success);
  const outDir = join(OUTPUT_DIR, "characters");
  await mkdir(outDir, { recursive: true });

  // Generate index.ts — dynamic imports only (no static re-exports to avoid bundling all 443 base64 spritesheets)
  const catalogEntries = successful
    .map((c) => {
      return `  ${JSON.stringify(c.dirName)}: () => import("${c.packageName}").then(m => m.character),`;
    })
    .join("\n");

  const source = `// Auto-generated umbrella package — lazy-loads all ${successful.length} character packs
// Do not edit manually — regenerate with scripts/generate-character-packages.ts
// NOTE: No static re-exports — only dynamic import() to avoid bundling all base64 spritesheets at once

/** All available character IDs */
export const characterIds = ${JSON.stringify(successful.map((c) => c.dirName))} as const;

export type CharacterId = typeof characterIds[number];

/** Lazy-loading catalog — use this for on-demand character loading */
export const catalog: Record<CharacterId, () => Promise<import("${SCOPE}/core").LegacyCharacterPack>> = {
${catalogEntries}
};
`;

  // Dependencies: all character packages
  const dependencies: Record<string, string> = {};
  for (const c of successful) {
    dependencies[c.packageName] = "workspace:*";
  }

  const packageJson = {
    name: `${SCOPE}/characters`,
    version: "1.0.0",
    description: `All ${successful.length} shimeji character packs for react-shimeji`,
    type: "module",
    main: "./index.ts",
    types: "./index.ts",
    exports: {
      ".": "./index.ts",
    },
    keywords: ["shimeji", "react-shimeji", "characters", "all"],
    license: "MIT",
    dependencies,
    repository: {
      type: "git",
      url: "https://github.com/CarbonNeuron/react-shimeji.git",
      directory: "packages/characters",
    },
  };

  await Promise.all([
    writeFile(join(outDir, "index.ts"), source),
    writeFile(
      join(outDir, "package.json"),
      JSON.stringify(packageJson, null, 2) + "\n"
    ),
  ]);
}

// Main
async function main() {
  console.log("🐱 Generating character packages...\n");

  const dirs = await getCharacterDirs();
  console.log(`Found ${dirs.length} character directories\n`);

  // Process in batches of 20 to avoid file descriptor limits
  const results: CharacterResult[] = [];
  const BATCH_SIZE = 20;
  for (let i = 0; i < dirs.length; i += BATCH_SIZE) {
    const batch = dirs.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map((d) => generateCharacterPackage(d))
    );
    results.push(...batchResults);

    const done = Math.min(i + BATCH_SIZE, dirs.length);
    process.stdout.write(`\r  Progress: ${done}/${dirs.length}`);
  }
  console.log("\n");

  // Report
  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log(`✅ Generated ${succeeded.length} character packages`);
  if (failed.length > 0) {
    console.log(`❌ Failed ${failed.length}:`);
    for (const f of failed) {
      console.log(`   ${f.dirName}: ${f.error}`);
    }
  }

  const totalSizeKB = succeeded.reduce((sum, r) => sum + (r.sizeKB ?? 0), 0);
  console.log(
    `\n📦 Total generated size: ${(totalSizeKB / 1024).toFixed(1)} MB`
  );

  // Generate umbrella
  console.log("\n📦 Generating umbrella @react-shimeji/characters...");
  await generateUmbrellaPackage(results);
  console.log("✅ Done!\n");

  // Summary
  console.log("Next steps:");
  console.log(
    '  1. Update root package.json "workspaces" to include character packages'
  );
  console.log("  2. Run `bun install` to link workspaces");
  console.log(
    "  3. Set up GitHub Actions to publish changed packages on push to main"
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
