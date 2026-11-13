import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const calls = [];
const claims = [];
const source = readFileSync(new URL('../lib/schedules/cliniSysSchedulesIntoSupabaseAndAds.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
vm.runInNewContext(compiled + '\nexports.sendAttendanceConversion = sendAttendanceConversion;', {
    exports, console, process, Date,
    require: name => {
        if (name === 'crypto') return require(name);
        if (name.endsWith('/sendScheduleConversionOnce')) return { sendScheduleConversionOnce: async input => {
            claims.push([input.platform, input.eventType, input.scheduleId]);
            return input.send();
        } };
        if (name.endsWith('/sendMetaEvents')) return { sendMetaEvents: async input => { calls.push(['meta', input]); return { ok: true }; } };
        if (name.endsWith('/sendGoogleEvents')) return { sendGoogleEvents: async input => { calls.push(['google', input]); return { ok: true }; } };
        if (name.startsWith('@/')) return {};
        throw new Error(`Unexpected dependency: ${name}`);
    },
});
for (const procedure of [
    '1ª Avaliação de Reprodução Humana - presencial',
    '1ª Avaliação de Reprodução Humana - online',
    '1° avaliação de reprodução humana - online',
    'Primeira avaliação de reprodução humana',
    '1a Avaliacao de Reproducao Humana',
]) {
    calls.length = 0; claims.length = 0;
    await exports.sendAttendanceConversion({ schedule: { procedure_name: procedure }, client: { id: 'qa' }, scheduleId: 'qa-schedule' });
    assert.deepEqual(calls.map(([platform]) => platform), ['meta', 'google'], procedure);
    assert.equal(claims.length, 2);
    assert.ok(claims.every(([, type, id]) => type === 'attendance' && id === 'qa-schedule'));
    assert.equal(calls[0][1].events[0].meta_event_name, 'Comparecimento');
}
for (const procedure of [null, '', 'Reavaliação de Reprodução Humana - presencial',
    'Avaliação de Reprodução Humana - online', 'Avaliação de Ciclo - Online',
    '1º USG - Preparo de endométrio', 'Transferência de embriões descongelados (TED)',
    'Contato com Paciente', '2ª Avaliação de Reprodução Humana']) {
    calls.length = 0; claims.length = 0;
    const result = await exports.sendAttendanceConversion({ schedule: { procedure_name: procedure }, client: { id: 'qa' }, scheduleId: 'qa-schedule' });
    assert.equal(calls.length, 0, String(procedure));
    assert.equal(claims.length, 0, 'Skipped procedures must not consume delivery claims');
    assert.equal(result.meta.skipped, true);
    assert.equal(result.google.skipped, true);
}
console.log('PASS: first evaluations sent to Meta/Google; returns, procedures and unknown types skipped before delivery claims.');
