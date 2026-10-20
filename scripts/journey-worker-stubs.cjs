// Preparation is pure. Any accidental network access in the worker must fail.
exports.supabase = new Proxy({}, { get() { throw new Error("Preparation must use its supplied source batch"); } });
exports.NextResponse = undefined;
