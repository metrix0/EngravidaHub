const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks = {}, globals = {}, suffix = '') {
    const exports = {};
    const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    vm.runInNewContext(source + suffix, {
        exports, require: name => name in mocks ? mocks[name] : require(name),
        console, Date, Intl, URL, URLSearchParams, process, setTimeout, ...globals,
    }, { filename: file });
    return exports;
}

const detail = messages => ({ item: {
    id: 'thread-1', thread_id: 'thread-1', item_type: 'thread',
    responsible: 'Atendente', messages, notes: [],
} });
const response = data => ({ ok: true, json: async () => data });
const saved = { id: 'saved-1', text: 'Olá', sender_type: 'attendant', sent_at: new Date().toISOString() };

async function cacheRace(confirmBeforeReload) {
    let resolveReload, resolveSend;
    const api = load('lib/inbox/inboxApi.ts', {}, {
        fetch: async (url, init) => {
            if (init.method === 'POST') return new Promise(resolve => { resolveSend = resolve; });
            if (!resolveReload) return new Promise(resolve => { resolveReload = resolve; });
            return response(detail([]));
        },
    });
    const seed = api.fetchInboxThread('thread-1');
    resolveReload(response(detail([])));
    await seed;
    resolveReload = null;
    const reload = api.fetchInboxThread('thread-1');
    const send = api.sendInboxMessage({ itemId: 'thread-1', itemType: 'thread', text: 'Olá' });
    if (confirmBeforeReload) {
        resolveSend(response({ ok: true, message: saved, thread_id: 'thread-1', reopened: false, persisted: true }));
        await send;
    }
    resolveReload(response(detail([])));
    const stale = await reload;
    assert.equal(stale.item.messages.length, 1, 'stale history must not erase an outgoing message');
    if (!confirmBeforeReload) {
        resolveSend(response({ ok: true, message: saved, thread_id: 'thread-1', reopened: false, persisted: true }));
        await send;
    }
    const current = await api.fetchInboxThread('thread-1');
    assert.equal(current.item.messages.length, 1);
    assert.equal(current.item.messages[0].id, saved.id);
}

async function persistenceRetry(failures, social = true) {
    let attempts = 0;
    const externalIds = [];
    const dbError = { code: '', message: 'TypeError: fetch failed' };
    const supabase = { from() {
        let write = false;
        const query = new Proxy({}, { get(_, key) {
            if (key === 'then') return (resolve, reject) => Promise.resolve().then(() => {
                if (!write) return { data: { sequence_index: 2 }, error: null };
                attempts += 1;
                return attempts <= failures
                    ? { data: null, error: dbError }
                    : { data: saved, error: null };
            }).then(resolve, reject);
            return (...args) => {
                if (key === 'upsert') { write = true; externalIds.push(args[0].external_id); }
                return query;
            };
        } });
        return query;
    } };
    const route = load('app/api/inbox/threads/[threadId]/messages/route.ts', {
        'next/server': {},
        '@/lib/attendants/getCurrentAttendantFromRequest': {},
        '@/lib/blip/sendBlipTextMessage': {},
        '@/lib/supabase/client': { supabase },
        '@/lib/zernio/client': {},
    }, { setTimeout: callback => { callback(); } }, '\nexports.persistSentMessage = persistSentMessage;');
    const result = await route.persistSentMessage({
        thread: { id: 'thread-1', client_id: social ? null : 'client-1', instagram_user_id: social ? 'social-1' : null },
        attendantName: 'Atendente', text: 'Olá', sentAt: saved.sent_at,
        externalId: 'zernio:already-sent', externalContactId: null, externalThreadId: 'remote-thread',
    });
    assert.equal(attempts, social ? Math.min(failures + 1, 3) : 1);
    assert.equal(result.ok, social ? failures < 3 : failures === 0);
    assert.ok(externalIds.every(id => id === 'zernio:already-sent'), 'retry only persists the same accepted message');
}

(async () => {
    await cacheRace(true);
    await cacheRace(false);
    await persistenceRetry(0);
    await persistenceRetry(1);
    await persistenceRetry(2);
    await persistenceRetry(3);
    await persistenceRetry(1, false);
    console.log('Inbox send: 7 regression scenarios passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
