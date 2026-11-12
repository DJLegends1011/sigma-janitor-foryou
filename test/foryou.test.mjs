// node --test test/*.test.mjs   (from the extension folder)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fillNameMacros, CARD_BATCH, homePath, cardsPath, parseSlate, normalizeCard, passesFilters, makeEvent, cardEventPayloads, avatarUrl, characterUrl } from '../client/core/recsys.js';
import { stopgapJanitorToken, decodeExpiry } from '../client/core/session.js';
import { createFeed } from '../client/core/feed.js';
import * as swipe from '../client/core/recsys.js';
import * as preview from '../client/core/preview.js';
import { register } from '../server/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'recsys.json'), 'utf8'));
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// ---------- paths ----------
test('paths stay under the consumer prefix and validate ids', () => {
    assert.equal(homePath(), '/hampter/recsys/home?limit=20&shape=ids');
    assert.match(homePath({ cursor: 'v3.a.b' }), /&cursor=v3\.a\.b$/);
    assert.equal(cardsPath([id(1), 'nope', id(2)]), `/hampter/recsys/home/cards?ids=${encodeURIComponent(`${id(1)},${id(2)}`)}`);
    assert.throws(() => cardsPath(['../x']));
    assert.equal(CARD_BATCH, 3);
    assert.throws(() => cardsPath([id(1), id(2), id(3), id(4)]), /at most 3/, 'the API answers 400 past three');
});

test('macros: {{user}} and {{char}} filled, case-insensitive; a missing name leaves the macro', () => {
    assert.equal(fillNameMacros('Hi {{user}}, I am {{Char}}. {{ USER }}!', { user: 'DJ', char: 'Maki' }), 'Hi DJ, I am Maki. DJ!');
    assert.equal(fillNameMacros('Hi {{user}}', {}), 'Hi {{user}}');
    assert.equal(normalizeCard(fx.cards.items[0]).chatName, 'Maki Zenin', 'no chat_name: the name before the first |');
});

// ---------- parsing ----------
test('slate: parses the live shape and de-dupes against seen ids', () => {
    const seen = new Set();
    const s = parseSlate(fx.home, seen);
    assert.equal(s.items.length, 3);
    assert.equal(s.items[0].recSource, 'vespa_ann');
    assert.ok(s.cursor.startsWith('v3.'));
    assert.equal(s.personalization, 'ready');
    assert.equal(parseSlate(fx.home, seen).items.length, 0, 'a second identical slate adds nothing');
});

test('card: normalizes the live cards shape', () => {
    const c = normalizeCard(fx.cards.items[0]);
    assert.equal(c.name, 'Maki Zenin | Succubus Series | JJK part');
    assert.equal(c.tokens, 2380);
    assert.equal(c.nsfw, true);
    assert.equal(c.chats, 1343);
    assert.equal(c.favorites, 390);
    assert.equal(c.followers, 4104);
    assert.ok(c.avatar.startsWith('https://ella.janitorai.com/bot-avatars/'));
    assert.ok(c.tags.includes('📺 Anime'));
    assert.equal(normalizeCard({ character: { ...fx.cards.items[0].character, is_deleted: true } }), null);
    assert.equal(normalizeCard(null), null);
});

test('creator avatar uses the profile avatar path, preserves HTTPS, and is absent when missing', () => {
    const item = fx.cards.items[0];
    assert.equal(normalizeCard(item).creatorAvatar, `https://ella.janitorai.com/avatars/${encodeURIComponent(item.creator_profile.avatar)}?width=100`);
    assert.equal(normalizeCard({ ...item, creator_profile: { avatar: 'https://example.com/avatar.webp?width=200' } }).creatorAvatar, 'https://example.com/avatar.webp?width=200');
    assert.equal(normalizeCard({ ...item, creator_profile: { avatar: 'a b.webp' } }).creatorAvatar, 'https://ella.janitorai.com/avatars/a%20b.webp?width=100');
    assert.equal(normalizeCard({ ...item, creator_profile: {} }).creatorAvatar, '');
    assert.equal(normalizeCard({ ...item, creator_profile: undefined }).creatorAvatar, '');
});

test('filters: NSFW off unless explicitly true; token floor', () => {
    const c = normalizeCard(fx.cards.items[0]);
    assert.equal(passesFilters(c, {}), false);
    assert.equal(passesFilters(c, { showNsfw: 'true' }), false, 'only boolean true opts in');
    assert.equal(passesFilters(c, { showNsfw: true }), true);
    assert.equal(passesFilters(c, { showNsfw: true, minTokens: 5000 }), false);
});

test('creator avatar: an http:// or other-scheme value is dropped, not mangled', () => {
    const base = fx.cards.items[0];
    const withAvatar = (a) => normalizeCard({ ...base, creator_profile: { ...base.creator_profile, avatar: a } }).creatorAvatar;
    assert.equal(withAvatar('http://evil.example/x.png'), '');
    assert.equal(withAvatar('javascript:alert(1)'), '');
    assert.equal(withAvatar('https://ella.janitorai.com/avatars/a.webp'), 'https://ella.janitorai.com/avatars/a.webp');
    assert.match(withAvatar('a b.webp'), /^https:\/\/ella\.janitorai\.com\/avatars\/a%20b\.webp\?width=100$/);
});

test('urls', () => {
    assert.equal(avatarUrl('a b.webp', 400), 'https://ella.janitorai.com/bot-avatars/a%20b.webp?width=400');
    assert.equal(avatarUrl('javascript:alert(1)'), 'https://ella.janitorai.com/bot-avatars/javascript%3Aalert(1)');
    assert.equal(characterUrl(id(1), 'Maki Zenin'), `https://janitorai.com/characters/${id(1)}_character-maki-zenin`);
});

// ---------- events ----------
test('event envelope matches the site (schema_version 1) and refuses big payloads', () => {
    const e = makeEvent('feed.character.shown', { a: 1 }, 'sess', 123);
    assert.deepEqual(Object.keys(e).sort(), ['client_ts', 'event_id', 'name', 'payload', 'platform', 'schema_version', 'session_id']);
    assert.equal(e.platform, 'web');
    assert.throws(() => makeEvent('x', { s: 'x'.repeat(5000) }, 's'));
    const p = cardEventPayloads({ id: id(1), impressionId: 'imp', position: 2, recSource: 'vespa_ann' }, { requestId: 'req', modelVersion: 'mv' }, 'cr', 1500.4);
    assert.equal(p.shown.surface_id, 'home_feed');
    assert.equal(p.dwell.dwell_ms, 1500);
    assert.equal(p.skipped.rec_source, 'vespa_ann');
});

// ---------- session stopgap ----------
const jwt = (exp) => `x.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.y`;
test('session: signed out, expired, ok, and no CoreAPI', () => {
    const ctx = (v) => ({ CoreAPI: { getSetting: () => v } });
    assert.deepEqual(stopgapJanitorToken({}), { ok: false, reason: 'no-api' });
    assert.deepEqual(stopgapJanitorToken(ctx(null)), { ok: false, reason: 'signed-out' });
    assert.deepEqual(stopgapJanitorToken(ctx(jwt(100)), 100_000), { ok: false, reason: 'expired' });
    const good = jwt(Math.floor(Date.now() / 1000) + 3600);
    assert.deepEqual(stopgapJanitorToken(ctx(good)), { ok: true, token: good });
    assert.equal(decodeExpiry('garbage'), 0);
    assert.deepEqual(stopgapJanitorToken({ CoreAPI: { getSetting: () => { throw new Error('x'); } } }), { ok: false, reason: 'no-api' });
});

// ---------- feed ----------
function fakeApi({ pages = 2, perPage = 5, nsfwEvery = 0, pending = 0 } = {}) {
    const calls = { home: 0, cards: 0, events: [], feedback: [], personalization: 0 };
    let n = 0;
    return {
        calls,
        async home({ cursor } = {}) {
            calls.home++;
            const page = cursor ? Number(cursor.split('.')[1]) : 0;
            if (pending > 0 && !cursor) { pending--; return { personalization: 'pending', items: [], next_cursor: '' }; }
            if (page >= pages) return { items: [], next_cursor: '' };
            const items = Array.from({ length: perPage }, () => ({ character_id: id(++n), impression_id: `imp${n}`, position: n, rec_source: 'vespa_ann' }));
            return { items, next_cursor: `v3.${page + 1}`, model_version: 'mv', request_id: `req${page}`, personalization: 'ready' };
        },
        async personalization() { calls.personalization++; return { status: 'ready' }; },
        async cards(ids) {
            calls.cards++;
            if (ids.length > 3) throw new Error('400 ids must contain no more than 3 elements');
            return { items: ids.map((cid, i) => ({ character_id: cid, favorite_count: 1, character: { id: cid, name: `C${cid.slice(-3)}`, creator_id: 'cr', total_tokens: 500, is_nsfw: nsfwEvery ? (Number(cid.slice(-3)) % nsfwEvery === 0) : false, is_public: true } })) };
        },
        async events(batch) { calls.events.push(...batch); },
        async notInterested(c, i) { calls.feedback.push([c, i]); },
    };
}

test('feed: walks forward across slates, back, and stops at the end', async () => {
    const api = fakeApi({ pages: 2, perPage: 3 });
    const feed = createFeed(api, { sleep: async () => {} });
    const first = await feed.start();
    assert.equal(first.id, id(1));
    const seenIds = [first.id];
    for (let c = await feed.next(); c; c = await feed.next()) seenIds.push(c.id);
    assert.equal(seenIds.length, 6, 'both slates, no duplicates');
    assert.equal(new Set(seenIds).size, 6);
    assert.equal((await feed.prev()).id, id(5));
    assert.equal(api.calls.events.length, 0, 'signals are off by default');
});

test('feed: NSFW cards are skipped client-side', async () => {
    const api = fakeApi({ pages: 1, perPage: 6, nsfwEvery: 2 });
    const feed = createFeed(api, { sleep: async () => {} });
    const out = [await feed.start()];
    for (let c = await feed.next(); c; c = await feed.next()) out.push(c);
    assert.deepEqual(out.map(c => c.id), [id(1), id(3), id(5)]);
});

test('feed: an all-NSFW feed with NSFW off reports what it hid (not "nothing left") and stops after 3 slates', async () => {
    const api = fakeApi({ pages: 10, perPage: 20, nsfwEvery: 1 });
    const feed = createFeed(api, { sleep: async () => {} });
    assert.equal(await feed.start(), null);
    const p = feed.position();
    assert.equal(p.hidden.nsfw, 60, 'three slates of 20, all hidden for NSFW');
    assert.equal(p.scanned, 60);
    assert.equal(api.calls.home, 3, 'gives up after 3 slates instead of paging forever');
    const shown = createFeed(fakeApi({ pages: 1, perPage: 3, nsfwEvery: 1 }), { filters: () => ({ showNsfw: true }), sleep: async () => {} });
    assert.ok(await shown.start(), 'with NSFW on the same feed shows cards');
});

test('feed: waits for personalization on a brand-new account', async () => {
    const api = fakeApi({ pending: 1 });
    const feed = createFeed(api, { sleep: async () => {} });
    assert.ok(await feed.start());
    assert.equal(api.calls.personalization, 1);
});

test('feed: with signals on it sends the site\'s events and feedback', async () => {
    let t = 0;
    const api = fakeApi({ pages: 1, perPage: 4 });
    const feed = createFeed(api, { sendSignals: () => true, now: () => (t += 1000), sleep: async () => {} });
    await feed.start();
    await feed.next();               // card 1: dwell + skipped
    await feed.notInterested();      // card 2: not_interested + feedback
    await feed.end();
    const names = api.calls.events.map(e => e.name);
    assert.equal(names[0], 'feed.session.started');
    for (const n of ['feed.character.shown', 'feed.character.dwell.ended', 'feed.character.skipped', 'feed.character.not_interested', 'feed.session.ended']) assert.ok(names.includes(n), n);
    assert.deepEqual(api.calls.feedback, [[id(2), 'imp2']]);
    assert.equal(new Set(api.calls.events.map(e => e.session_id)).size, 1);
});

test('backdrop plan ping-pongs even and odd images and clamps the end', () => {
    assert.deepEqual(swipe.backdropPlan(150, 100, 5), { a: 1, frac: .5, front: 0, slides: [2, 1] });
    assert.deepEqual(swipe.backdropPlan(200, 100, 5), { a: 2, frac: 0, front: 1, slides: [2, 3] });
    assert.deepEqual(swipe.backdropPlan(-10, 100, 5), { a: 0, frac: 0, front: 1, slides: [0, 1] });
    assert.deepEqual(swipe.backdropPlan(900, 100, 5), { a: 4, frac: 1, front: 1, slides: [4, null] });
    assert.deepEqual(swipe.backdropPlan(0, 0, 0), { a: 0, frac: 0, front: 1, slides: [null, null] });
});

for (const signals of [false, true]) test(`swipe goTo bookkeeping, signals=${signals}`, async () => {
    let t = 0;
    const api = fakeApi({ pages: 1, perPage: 9, nsfwEvery: 2 });
    const requests = [];
    const cards = api.cards;
    api.cards = ids => { requests.push(ids); return cards(ids); };
    const feed = createFeed(api, { sendSignals: () => signals, now: () => t, filters: () => ({ minTokens: 100 }) });
    await feed.start();
    await feed.loadMore(6);
    assert.deepEqual(feed.cards().map(c => c.id), [id(1), id(3), id(5), id(7), id(9)]);
    assert.ok(requests.length >= 3);
    assert.ok(requests.every(ids => ids.length <= 3));
    t = 1200;
    await feed.goTo(3);
    assert.equal(feed.current().id, id(7));
    await feed.goTo(3); // observer reporting the same slide is not another impression
    feed.markEngaged();
    t = 3500;
    await feed.goTo(1);
    await feed.end();
    const events = api.calls.events;
    if (!signals) assert.deepEqual(events, []);
    else {
        assert.deepEqual(events.filter(e => e.name === 'feed.character.shown').map(e => e.payload.character_id), [id(1), id(7), id(3)]);
        assert.deepEqual(events.filter(e => e.name === 'feed.character.skipped').map(e => e.payload.character_id), [id(1), id(3)]);
        assert.equal(events.find(e => e.name === 'feed.character.dwell.ended').payload.dwell_ms, 1200);
        assert.equal(events.find(e => e.name === 'feed.session.ended').payload.cards_shown, 3);
    }
});

test('preview readiness fails safely for absent, throwing and stalled registry internals', async () => {
    const p = { id: 'janitorai', browseView: { _initialized: false } };
    const document = { getElementById: () => ({ classList: { contains: () => true } }) };
    for (const activateProvider of [undefined, () => { throw Error('cold'); }, () => new Promise(() => {})]) {
        const window = { ProviderRegistry: { activateProvider, deactivateCurrentProvider() {}, getActiveProviderId: () => 'janitorai' } };
        const result = await preview.stopgapReadyProviderPreview(p, { window, document, timeoutMs: 5 });
        assert.equal(result.ok, false);
        assert.match(result.reason, /Online/);
    }
    let parked = 0;
    const window = { ProviderRegistry: {
        activateProvider: async () => { p.browseView._initialized = true; },
        getActiveProviderId: () => p.id,
        deactivateCurrentProvider: () => { parked++; },
    } };
    assert.deepEqual(await preview.stopgapReadyProviderPreview(p, { window, document }), { ok: true });
    assert.equal(parked, 1);
});

test('turning Teach off discards queued signals before leave flushes', async () => {
    let enabled = true;
    const api = fakeApi();
    const feed = createFeed(api, { sendSignals: () => enabled });
    await feed.start();
    enabled = false;
    await feed.end();
    assert.deepEqual(api.calls.events, []);
});

// ---------- server ----------
test('server: registers a recsys-only consumer and reports it', async () => {
    let spec = null;
    const routes = {};
    register({ get: (p, fn) => { routes[p] = fn; } }, { browser: { consumer: (s) => { spec = s; return `janitor-foryou:${s.name}`; } } });
    assert.equal(spec.origin, 'https://janitorai.com');
    assert.equal(spec.fetchPrefix, '/hampter/recsys/');
    let body;
    routes['/status']({}, { json: (b) => { body = b; } });
    assert.deepEqual(body, { available: true, reason: '', consumer: 'janitor-foryou:janitor' });
});

test('server: a missing browser door degrades to unavailable', () => {
    const routes = {};
    const warn = console.warn; console.warn = () => {};
    try { register({ get: (p, fn) => { routes[p] = fn; } }, { browser: { consumer: () => { throw new Error('no browser'); } } }); }
    finally { console.warn = warn; }
    let body;
    routes['/status']({}, { json: (b) => { body = b; } });
    assert.equal(body.available, false);
    assert.match(body.reason, /no browser/);
});

// ---------- boundary lint (Sigma's extension-kit), when a checkout is beside us ----------
test('lintExtension passes', async (t) => {
    const sigma = process.env.SIGMA_DIR || 'D:/ProjectSigma-main';
    const lint = path.join(sigma, 'tools', 'extension-kit', 'lint.mjs');
    if (!fs.existsSync(lint)) return t.skip('no Sigma checkout');
    const { lintExtension } = await import(pathToFileURL(lint).href);
    const res = await lintExtension(path.resolve(here, '..'));
    const problems = Array.isArray(res) ? res : (res?.problems || res?.failures || []);
    assert.deepEqual(problems, []);
});
