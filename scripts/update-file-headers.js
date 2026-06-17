// scripts/update-file-headers.js
const fs = require("fs");
const path = require("path");

const REPO_ROOT = process.cwd();

const EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);

const IGNORE_DIRS = new Set([
    "node_modules",
    ".git",
    ".next",
    "dist",
    "build",
    "out",
    "coverage",
    "public"
]);

function walk(dir) {
    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
        const fullPath = path.join(dir, item.name);

        if (item.isDirectory()) {
            if (!IGNORE_DIRS.has(item.name)) {
                walk(fullPath);
            }

            continue;
        }

        if (!EXTENSIONS.has(path.extname(item.name))) {
            continue;
        }

        updateHeader(fullPath);
    }
}

function updateHeader(filePath) {
    const relativePath = path.relative(REPO_ROOT, filePath).replaceAll("\\", "/");
    const header = `// ${relativePath}`;

    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);

    const firstLine = lines[0] ?? "";

    if (firstLine.startsWith("// ") && firstLine.includes("/")) {
        lines[0] = header;
    } else {
        lines.unshift(header);
    }

    fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

walk(REPO_ROOT);