import assert from 'node:assert/strict';
import { buildDeskPerformance, loadDeskPerformance, type DeskTicket } from '../lib/blip/deskPerformance';
import { buildPerformanceReport, type PerformanceSource } from '../lib/performance/report';
const source: PerformanceSource = {people:[{id:'maria',name:'Maria Resende',sector:'ra',active:true},{id:'other',name:'Maria Fernandes',sector:'other',active:true}],units:[],period:[],monthly:[],bookings:[{date:'2026-10-01',attendant_name:'Maria Luísa Fernandes Resende',unit_name:'Campinas',appointments:51}]};
assert.equal(buildPerformanceReport(source,'2026-10-01','2026-10-28').coverage.matchedBookings,0);
const result=buildPerformanceReport({...source,attendant_aliases:[{source_name:'Maria Luísa Fernandes Resende',attendant_id:'maria'}]},'2026-10-01','2026-10-28');
assert.equal(result.attendants.find(p=>p.id==='maria')?.appointments,51);
assert.equal(result.coverage.matchedBookings,51);
assert.equal(result.units[0].ra,51);
assert.equal(result.unitAttributions[0].attendantId,'maria');
assert.equal(result.attendants.find(p=>p.id==='maria')?.monthly.at(-1)?.appointments,51);
assert.equal(buildPerformanceReport({...source,attendant_aliases:[{source_name:'Maria Luísa Fernandes Resende',attendant_id:'inactive'}]},'2026-10-01','2026-10-28').coverage.matchedBookings,0);
console.log('PASS verified alias attribution: ranking, monthly chart, unit contribution, coverage; ambiguous and inactive identities remain unassigned.');

const octoberStart = Date.parse('2026-10-01T03:00:00Z');
const octoberEnd = Date.parse('2026-11-01T03:00:00Z');
const ticket: DeskTicket = {
    id: 'example', team: 'Assistências SP', agentIdentity: 'central%40example.com@blip.ai',
    status: 'ClosedAttendant', storageDate: '2026-09-30T20:00:00-03:00',
    openDate: '2026-10-01T07:05:00-03:00', firstResponseDate: '2026-10-01T07:10:00-03:00',
    closeDate: '2026-10-01T08:00:00-03:00',
};
const lostTicket: DeskTicket = {
    ...ticket, id: 'lost', agentIdentity: null, status: 'ClosedClient', openDate: null,
    firstResponseDate: null, storageDate: '2026-10-01T00:00:00-03:00',
};
const desk = buildDeskPerformance([
    ticket,
    lostTicket,
    { ...ticket, id: 'ra', team: 'RA', status: 'ClosedClientInactivity',
        storageDate: '2026-10-31T23:00:00-03:00', closeDate: '2026-11-01T00:00:00-03:00' },
], octoberStart, octoberEnd, new Set(['central@example.com']));
assert.equal(desk.ac.opened, 1);
assert.equal(desk.ac.closed, 2);
assert.equal(desk.ac.lost, 1);
assert.equal(desk.ac.firstResponse, 5 * 60);
assert.equal(desk.ac.collaborators, 1);
assert.equal(desk.acTickets, 1);
assert.equal(desk.ra.opened, 1);
assert.equal(desk.ra.closed, 0);
assert.equal(desk.ra.abandoned, 1);
assert.equal(desk.units.find(unit => unit.name === 'São Paulo')?.acTickets, 1);
assert.equal(buildDeskPerformance([ticket], octoberStart, octoberEnd, new Set()).acTickets, null);

async function checkDeskPagination() {
    const restoreFetch = globalThis.fetch;
    const originalKey = process.env.BLIP_PERFORMANCE_AUTH_KEY;
    const originalRoster = process.env.BLIP_PERFORMANCE_AC_ATTENDANTS;
    try {
        process.env.BLIP_PERFORMANCE_AUTH_KEY = Buffer.from('atendimento638573549519907613:fixture').toString('base64');
        process.env.BLIP_PERFORMANCE_AC_ATTENDANTS = 'central@example.com';
        const offsets: number[] = [];
        globalThis.fetch = (async (url, init) => {
            assert.equal(new URL(String(url)).pathname, '/commands');
            const body = JSON.parse(String(init?.body));
            const query = new URL(body.uri, 'https://example.com').searchParams;
            assert.equal(body.to, 'postmaster@desk.msging.net');
            assert.equal(Number(query.get('$take')), 500);
            const filter = query.get('$filter') ?? '';
            if (filter.includes("closeDate ge datetimeoffset'2026-10-02T03:00:00.000Z'")) {
                return Response.json({ status: 'success', resource: { items: [
                    { ...ticket, id: 'page-last', openDate: '2026-10-02T07:05:00-03:00' },
                ] } });
            }
            assert.match(filter, /closeDate ge datetimeoffset'2026-10-01T03:00:00.000Z'/);
            const offset = Number(query.get('$skip'));
            offsets.push(offset);
            return Response.json({ status: 'success', resource: { items: offset === 0
                ? Array.from({ length: 500 }, (_, i) => ({ ...ticket, id: 'page-' + i }))
                : [{ ...ticket, id: 'page-last' }] } });
        }) as typeof fetch;
        const data = await loadDeskPerformance('2026-10-01', '2026-10-01');
        assert.deepEqual(offsets, [0, 500]);
        assert.equal(data.ac.closed, 501);
        assert.equal(data.acTickets, 501);
        const overlapping = await loadDeskPerformance('2026-10-01', '2026-10-02');
        assert.deepEqual(offsets, [0, 500]);
        assert.equal(overlapping.ac.closed, 501);
        assert.equal(overlapping.acTickets, 501);

        globalThis.fetch = (async () => Response.json({ status: 'success', resource: { items: [
            { ...ticket, openDate: null, closeDate: '2026-09-30T23:59:00-03:00' },
        ] } })) as typeof fetch;
        await assert.rejects(loadDeskPerformance('2026-10-03', '2026-10-03'), /não aplicou o intervalo/);
        console.log('PASS Blip contribution, status and date rules, pagination, and out-of-range response rejection.');
    } finally {
        globalThis.fetch = restoreFetch;
        if (originalKey === undefined) delete process.env.BLIP_PERFORMANCE_AUTH_KEY;
        else process.env.BLIP_PERFORMANCE_AUTH_KEY = originalKey;
        if (originalRoster === undefined) delete process.env.BLIP_PERFORMANCE_AC_ATTENDANTS;
        else process.env.BLIP_PERFORMANCE_AC_ATTENDANTS = originalRoster;
    }
}

void checkDeskPagination().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
