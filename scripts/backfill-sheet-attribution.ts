// scripts/backfill-sheet-attribution.ts
function readNumberArgument(name: string, fallback: number) {
    const prefix = `--${name}=`;
    const argument = process.argv.find((value) => value.startsWith(prefix));
    if (!argument) return fallback;

    const parsed = Number(argument.slice(prefix.length));
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid --${name} value: ${argument}`);
    }

    return Math.floor(parsed);
}

async function main() {
    // supabase-js 2.108+ initializes its Realtime client even though this
    // script only uses HTTP database calls. Node.js 20 has no native
    // WebSocket, so install the project's existing `ws` transport before the
    // Supabase module is imported. Node.js 22+ keeps its native transport.
    if (typeof globalThis.WebSocket === "undefined") {
        const { default: NodeWebSocket } = await import("ws");

        Object.defineProperty(globalThis, "WebSocket", {
            value: NodeWebSocket,
            configurable: true,
            writable: true,
        });
    }

    const { runFullSheetAttributionBackfill } = await import(
        "@/lib/conversations/matchConversationsSheetAttribution"
    );
    const dryRun = process.argv.includes("--dry-run");
    const sheetChunkSize = readNumberArgument("sheet-chunk-size", 10_000);
    const rpcBatchSize = readNumberArgument("rpc-batch-size", 500);
    const result = await runFullSheetAttributionBackfill({
        dryRun,
        sheetChunkSize,
        rpcBatchSize,
    });

    console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
    console.error("[sheet-attribution-backfill] failed", {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
    });
    process.exitCode = 1;
});
