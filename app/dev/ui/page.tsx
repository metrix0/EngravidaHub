// app/dev/ui/page.tsx
"use client";
import { uiRegistry } from "./uiRegistry.generated";

export default function DevUiPage() {
    return (
        <main className="min-h-screen bg-slate-50 px-8 py-10 text-slate-900">
            <div className="mx-auto max-w-5xl">
                <div className="mb-10">
                    <h1 className="text-3xl font-bold">UI Components</h1>
                    <p className="mt-2 text-sm text-slate-500">
                        Auto-generated from <code>src/components/ui</code>.
                    </p>
                </div>

                <div className="space-y-8">
                    {uiRegistry.map((demo) => (
                        <section
                            key={demo.name}
                            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
                        >
                            <h2 className="mb-5 text-xl font-bold">{demo.name}</h2>

                            <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-6">
                                {demo.element}
                            </div>

                            <pre className="overflow-x-auto rounded-xl bg-slate-950 p-4 text-sm text-slate-100">
                                <code>{"code" in demo ? demo.code : ""}</code>
                            </pre>
                        </section>
                    ))}
                </div>
            </div>
        </main>
    );
}
