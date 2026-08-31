import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.resolve(
  process.argv[2] ?? path.join(root, "docs/interactive/worksurface-implementation.architecture.json"),
);
const artifactPath = path.resolve(
  process.argv[3] ?? path.join(root, "docs/interactive/worksurface-system.html"),
);

const source = JSON.parse(await readFile(sourcePath, "utf8"));
const entries = source.meta?.legend?.entries ?? {};
const labels = Object.fromEntries(
  Object.entries(entries)
    .filter(([, entry]) => typeof entry?.label === "string" && entry.label.trim())
    .map(([kind, entry]) => [kind, entry.label.trim()]),
);

const html = await readFile(artifactPath, "utf8");
const i18nPattern = /(<script\b(?=[^>]*\bid="archify-i18n-data")(?=[^>]*\btype="application\/json")[^>]*>\s*)(\{.*?\})(\s*<\/script>)/s;
const match = html.match(i18nPattern);
if (!match) {
  throw new Error(`Archify i18n payload not found in ${artifactPath}`);
}

const i18n = JSON.parse(match[2]);
i18n.messages ??= {};
for (const [kind, label] of Object.entries(labels)) {
  i18n.messages[`viewer.kind.${kind}`] = label;
}

const output = html.replace(i18nPattern, `$1${JSON.stringify(i18n)}$3`);
await writeFile(artifactPath, output);
console.log(`Applied ${Object.keys(labels).length} WorkSurface domain labels to ${artifactPath}`);
