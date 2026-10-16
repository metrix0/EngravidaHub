import type { AgendaCounts } from "./operationalAgenda";

// Match the reference monthly report: all unfilled slots are available, and
// occupancy is (AG_RA + AG_UNIDADE) / all slots, including blocked/other statuses.
// Keep the calendar's physical occupancy calculation separate.
export function monthlyAgendaCounts<T extends AgendaCounts>(counts: T): T {
    return {
        ...counts,
        available: counts.available + counts.open,
        open: 0,
        occupancy: counts.total ? (counts.ra + counts.unit) / counts.total * 100 : 0,
        raOccupancy: counts.total ? counts.ra / counts.total * 100 : 0,
        unitOccupancy: counts.total ? counts.unit / counts.total * 100 : 0,
    };
}
