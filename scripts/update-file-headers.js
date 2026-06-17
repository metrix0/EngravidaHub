// scripts/update-file-headers.js
import fs from "fs";
import path from "path";

import { fileURLToPath } from "url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const ROOT = process.cwd();

const EXTENSIONS = [".js", ".jsx", ".ts", ".tsx"];
const IGNORE_DIRS = [
    "node_modules",
    ".git",
    ".next",
    "dist",
    "build",
    "out",
    "coverage",
    "public"
];

function walk(dir) {
    const items = fs.readdirSync(dir);

    for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            if (!IGNORE_DIRS.includes(item)) {
                walk(fullPath);
            }
            continue;
        }

        const ext = path.extname(fullPath);
        if (!EXTENSIONS.includes(ext)) continue;

        updateHeader(fullPath);
    }
}

function updateHeader(filePath) {
    const relativePath = path.relative(REPO_ROOT, filePath).replaceAll("\\", "/");
    const header = `// ${relativePath}`;

    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");

    if (lines[0]?.startsWith("// ") && lines[0]?.includes("/")) {
        lines[0] = header;
    } else {
        lines.unshift(header);
    }

    fs.writeFileSync(filePath, lines.join("\n"));
}

walk(ROOT);