const esbuild = require("esbuild");
const path = require("node:path");
esbuild.build({
    stdin: { contents: 'export { prepareJourneyPatients } from "./lib/dashboard/journeyEngine";', resolveDir: path.resolve(__dirname, "..") },
    bundle: true, format: "esm", platform: "neutral", target: "es2024", treeShaking: true, external: ["node:crypto"],
    outfile: path.resolve(__dirname, "../supabase/functions/journey-refresh/journey-engine.mjs"),
    plugins: [{ name: "pure-preparation", setup(build) { build.onResolve({ filter: /^(?:@\/lib|next\/server)$/ }, () => ({ path: path.resolve(__dirname, "journey-worker-stubs.cjs") })); } }],
});
