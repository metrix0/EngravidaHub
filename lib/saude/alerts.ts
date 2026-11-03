// lib/saude/alerts.ts
import "server-only";

import { supabase } from "@/lib/supabase/client";
import type { HealthSnapshot, HealthService } from "@/lib/saude/monitor";

export type HealthAlert = {
    id: string;
    alert_key: string;
    source: string;
    service: string;
    title: string;
    details: string;
    severity: "warning" | "critical";
    status: "active" | "acknowledged" | "resolved";
    occurrences: number;
    first_seen_at: string;
    last_seen_at: string;
    acknowledged_at: string | null;
    resolved_at: string | null;
    updated_at: string;
};

export async function readHealthAlerts() {
    const { data, error } = await supabase.from("health_alerts")
        .select("*").order("last_seen_at", { ascending: false }).limit(100);
    if (error) throw new Error(error.message);
    return (data ?? []) as HealthAlert[];
}

export async function acknowledgeHealthAlert(id: string) {
    const { data, error } = await supabase.from("health_alerts")
        .update({ status: "acknowledged", acknowledged_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", id).eq("status", "active").select("id").maybeSingle();
    if (error) throw new Error(error.message);
    return Boolean(data);
}

function issueKey(service: HealthService) {
    return "health:" + service.id;
}

export async function synchronizeHealthAlerts(snapshot: HealthSnapshot) {
    const { data, error } = await supabase.from("health_alerts")
        .select("*").in("status", ["active", "acknowledged"]);
    if (error) throw new Error(error.message);
    const active = (data ?? []) as HealthAlert[];
    const byKey = new Map(active.map(item => [item.alert_key, item]));
    const now = new Date().toISOString();

    const issues = snapshot.services.filter(service =>
        service.status === "failed" || service.status === "warning",
    );
    for (const service of issues) {
        const key = issueKey(service);
        const previous = byKey.get(key);
        const seenAt = service.last_failure || service.last_seen || now;
        const newer = !previous || Date.parse(seenAt) > Date.parse(previous.last_seen_at);
        if (previous && !newer && previous.status !== "resolved") continue;
        const severity = service.status === "failed" ? "critical" : "warning";
        const payload = {
            alert_key: key,
            source: service.category,
            service: service.name,
            title: service.status === "failed" ? "Falha em " + service.name : "Atenção: " + service.name,
            details: service.detail,
            severity,
            status: newer ? "active" : previous?.status ?? "active",
            occurrences: (previous?.occurrences ?? 0) + (newer ? 1 : 0),
            first_seen_at: previous?.first_seen_at ?? seenAt,
            last_seen_at: seenAt,
            acknowledged_at: newer ? null : previous?.acknowledged_at ?? null,
            resolved_at: null,
            updated_at: now,
        };
        const { error: writeError } = await supabase.from("health_alerts").upsert(payload, { onConflict: "alert_key" });
        if (writeError) throw new Error(writeError.message);
    }

    for (const item of active) {
        if (issues.some(service => issueKey(service) === item.alert_key)) continue;
        const service = snapshot.services.find(entry => issueKey(entry) === item.alert_key);
        if (!service || service.status !== "healthy") continue;
        const successfulAt = service.last_success ? Date.parse(service.last_success) : 0;
        if (successfulAt <= Date.parse(item.last_seen_at)) continue;
        const { error: updateError } = await supabase.from("health_alerts")
            .update({ status: "resolved", resolved_at: now, updated_at: now })
            .eq("id", item.id).in("status", ["active", "acknowledged"]);
        if (updateError) throw new Error(updateError.message);
    }

    for (const source of ["vercel", "supabase"] as const) {
        const state = snapshot.sources[source];
        const key = "health:source:" + source;
        const previous = byKey.get(key);
        if (!state.ok && !previous) {
            const { error: writeError } = await supabase.from("health_alerts").upsert({
                alert_key: key, source: "api", service: source === "vercel" ? "Vercel API" : "Supabase",
                title: "Monitoramento de " + source + " indisponível",
                details: state.detail, severity: "critical", status: "active",
                first_seen_at: now, last_seen_at: now, updated_at: now,
            }, { onConflict: "alert_key" });
            if (writeError) throw new Error(writeError.message);
        } else if (state.ok && previous) {
            const { error: updateError } = await supabase.from("health_alerts")
                .update({ status: "resolved", resolved_at: now, updated_at: now })
                .eq("id", previous.id);
            if (updateError) throw new Error(updateError.message);
        }
    }
}
