export type JourneyAnchor = { left: number; top: number; right: number; bottom: number };
export type JourneyConnection = { key: string; path: string; arrow: string; color: string; label: string; labelX: number; labelY: number };

// All coordinates come from rendered card borders, including their detail buttons.
export function journeyConnections(
    anchors: Record<string, JourneyAnchor>,
    labels: { consultationRevenue: string; instagramWhatsapp?: string; instagramConsultations?: string },
): JourneyConnection[] {
    const result: JourneyConnection[] = [];
    const consultation = anchors.attended;
    const revenue = anchors.authorized;
    if (consultation && revenue) {
        const start = (consultation.left + consultation.right) / 2;
        const end = (revenue.left + revenue.right) / 2;
        const lane = Math.min(consultation.top, revenue.top) - 36;
        result.push({ key: "consultation_revenue", color: "#0f9f61",
            path: `M ${start} ${consultation.top} V ${lane} H ${end} V ${revenue.top}`,
            arrow: `M ${end - 5} ${revenue.top - 6} L ${end} ${revenue.top} L ${end + 5} ${revenue.top - 6}`,
            label: labels.consultationRevenue, labelX: (start + end) / 2, labelY: lane - 9 });
    }
    const instagram = anchors.instagram_chat;
    const whatsapp = anchors.tracked_whatsapp;
    const scheduled = anchors.scheduled;
    if (instagram && whatsapp && labels.instagramWhatsapp !== undefined) {
        const y = (instagram.top + instagram.bottom) / 2 - 12;
        const x = (whatsapp.left + whatsapp.right) / 2;
        const lane = Math.max(instagram.right, whatsapp.right) + 28;
        result.push({ key: "instagram_whatsapp", color: "#0f9f94",
            path: `M ${instagram.right} ${y} H ${lane} V ${whatsapp.bottom + 24} H ${x} V ${whatsapp.bottom}`,
            arrow: `M ${x - 5} ${whatsapp.bottom + 6} L ${x} ${whatsapp.bottom} L ${x + 5} ${whatsapp.bottom + 6}`,
            label: labels.instagramWhatsapp, labelX: lane + 10, labelY: y - 12 });
    }
    if (instagram && scheduled && labels.instagramConsultations !== undefined) {
        const y = (instagram.top + instagram.bottom) / 2 + 12;
        const x = (scheduled.left + scheduled.right) / 2;
        result.push({ key: "instagram_consultation", color: "#8b5cf6",
            path: `M ${instagram.right} ${y} H ${x} V ${scheduled.bottom}`,
            arrow: `M ${x - 5} ${scheduled.bottom + 6} L ${x} ${scheduled.bottom} L ${x + 5} ${scheduled.bottom + 6}`,
            label: labels.instagramConsultations, labelX: (instagram.right + x) / 2, labelY: y + 20 });
    }
    return result;
}
