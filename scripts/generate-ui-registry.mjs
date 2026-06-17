import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");

const componentsDir = path.join(root, "components", "ui");

const outputFile = path.join(
    root,
    "app",
    "dev",
    "ui",
    "uiRegistry.generated.tsx"
);

const ignoredFiles = new Set(["index.ts", "index.tsx"]);
const ignoredDirs = new Set(["node_modules", ".next", "dist", "build"]);

function sortDirs(dirs) {
    return dirs.sort((a, b) => {
        if (a === "ui") return -1;
        if (b === "ui") return 1;
        return a.localeCompare(b);
    });
}

function walk(dir) {
    if (!fs.existsSync(dir)) {
        console.error(`[ui] Components dir does not exist: ${componentsDir}`);
        return [];
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    const dirs = sortDirs(
        entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .filter((name) => !ignoredDirs.has(name))
    );

    const files = entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((file) => file.endsWith(".tsx"))
        .filter((file) => !ignoredFiles.has(file))
        .sort();

    const result = [];

    for (const file of files) {
        const filePath = path.join(dir, file);
        const source = fs.readFileSync(filePath, "utf8");

        if (!source.includes("__uiDemo")) {
            continue;
        }

        const relativePath = path.relative(componentsDir, filePath);
        const withoutExtension = relativePath.replace(/\.tsx$/, "");
        const normalizedPath = withoutExtension.replaceAll(path.sep, "/");

        result.push({
            filePath,
            importPath: `@/components/ui/${normalizedPath}`,
            componentName: normalizedPath
        });
    }

    for (const folder of dirs) {
        result.push(...walk(path.join(dir, folder)));
    }

    return result;
}

console.log("[ui] Root:", root);
console.log("[ui] Components:", path.relative(root, componentsDir));
console.log("[ui] Output:", path.relative(root, outputFile));

const files = walk(componentsDir);

console.log("[ui] Found demo files:");
for (const file of files) {
    console.log("  -", path.relative(root, file.filePath));
}

const imports = [];
const registryItems = [];

for (const file of files) {
    const importName =
        file.componentName
            .replace(/[^a-zA-Z0-9]/g, "_")
            .replace(/^(\d)/, "_$1") + "Demo";

    imports.push(
        `import { __uiDemo as ${importName} } from "${file.importPath}";`
    );

    registryItems.push(`  {
    name: "${file.componentName}",
    ...${importName},
  },`);
}

const content = `// AUTO-GENERATED FILE.
// Do not edit manually.
// Run: pnpm ui

${imports.join("\n")}

export const uiRegistry = [
${registryItems.join("\n")}
].filter(Boolean);
`;

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, content);

console.log(`[ui] Generated UI registry with ${files.length} components.`);