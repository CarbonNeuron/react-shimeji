#!/usr/bin/env bun
/** Generate static JSON files without loading the full character set in memory. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type LegacyPack = {
  id: string;
  name?: string;
  metadata?: Record<string, unknown>;
};

const sourceDirectory = process.argv[2] ?? join(import.meta.dir, "..", "packages");
const outputDirectory = process.argv[3] ?? join(import.meta.dir, "..", "cdn", "site");
const packagePrefix = "@react-shimeji/character-";
const manifest = JSON.parse(await readFile(join(sourceDirectory, "characters", "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};
const ids = Object.keys(manifest.dependencies)
  .filter((name) => name.startsWith(packagePrefix))
  .map((name) => name.slice(packagePrefix.length))
  .sort();

await mkdir(join(outputDirectory, "characters"), { recursive: true });
const catalog: Array<{ id: string; name: string; group?: string; groupName?: string }> = [];

for (const [index, id] of ids.entries()) {
  const source = await readFile(join(sourceDirectory, `character-${id}`, "index.ts"), "utf8");
  const expression = source.match(
    /export const character = ([\s\S]+) as const;\s*export default character;\s*$/,
  )?.[1];
  if (!expression) throw new Error(`Missing character data for ${id}; check the Git LFS checkout`);
  const pack = Function(`"use strict"; return (${expression});`)() as LegacyPack;
  // Three legacy display IDs contain characters npm cannot use in a package
  // name. The CDN's stable ID is the package directory name.
  pack.id = id;

  const metadata = pack.metadata ?? {};
  catalog.push({
    id,
    name: pack.name ?? id.replaceAll("-", " "),
    ...(typeof metadata.group === "string" && { group: metadata.group }),
    ...(typeof metadata.groupName === "string" && { groupName: metadata.groupName }),
  });
  await writeFile(join(outputDirectory, "characters", `${id}.json`), JSON.stringify(pack));
  if ((index + 1) % 250 === 0) console.log(`Generated ${index + 1}/${ids.length} characters`);
}

await writeFile(join(outputDirectory, "index.json"), JSON.stringify(catalog));
await writeFile(join(outputDirectory, "healthz"), "ok\n");
console.log(`Generated ${catalog.length} characters in ${outputDirectory}`);
