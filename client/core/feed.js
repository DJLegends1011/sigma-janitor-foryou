// The feed as a small state machine, independent of the DOM: slates of ids in, hydrated cards out,
// one active card at a time, optional site signals. `api` is createApi()'s shape (injected for tests).
import { parseSlate, normalizeCard, passesFilters, makeEvent, cardEventPayloads, uuid, CARD_BATCH, QUICK_SKIP_MS, SURFACE_ID } from './recsys.js';

const PERSONALIZATION_POLLS = 4;
const POLL_MS = 1000;
const MAX_SLATES_PER_FILL = 3; // look through up to 60 recommendations for one that passes the filters

export function createFeed(api, { filters = () => ({}), sendSignals = () => false, now = () => Date.now(), sleep = (ms) => new Promise(r => setTimeout(r, ms)) } = {}) {
    const seen = new Set();
    const entries = [];          // { entry, slate, card|null, filtered }
    let cursor = '';
    let hasMore = true;
    let index = -1;
    let active = null;           // { at, entry, slate, card, engaged }
    let session = null;
    let queue = [];
    let personalizing = false;
    let slatesLoaded = 0;
    const hidden = { nsfw: 0, small: 0 }; // why cards were filtered out, for an honest empty state

    const visible = () => entries.filter(e => e.card && !e.filtered);

    async function emit(name, payload) {
        if (!sendSignals()) return;
        if (!session) {
            session = { id: uuid(), started: now(), shown: 0 };
            queue.push(makeEvent('feed.session.started', { surface_id: SURFACE_ID }, session.id, now()));
        }
        queue.push(makeEvent(name, payload, session.id, now()));
        if (queue.length >= 20) await flush();
    }

    async function flush() {
        if (!sendSignals()) { queue = []; return; }
        if (!queue.length) return;
        const batch = queue.splice(0, 50);
        try { await api.events(batch); } catch { /* telemetry is best effort */ }
    }

    async function loadSlate() {
        if (!hasMore) return 0;
        let json = await api.home({ cursor });
        if (json?.personalization === 'pending' && !cursor && !entries.length) {
            personalizing = true;
            for (let i = 0; i < PERSONALIZATION_POLLS; i++) {
                await sleep(POLL_MS);
                const p = await api.personalization().catch(() => null);
                if (p?.status === 'ready') { json = await api.home({ cursor }); break; }
                if (p?.status !== 'pending') break;
            }
            personalizing = false;
        }
        const slate = parseSlate(json, seen);
        slatesLoaded += 1;
        cursor = slate.cursor;
        hasMore = !!slate.cursor && slate.items.length > 0;
        for (const entry of slate.items) entries.push({ entry, slate, card: null, filtered: false, hydrated: false });
        return slate.items.length;
    }

    async function hydrate() {
        const todo = entries.filter(e => !e.hydrated).slice(0, CARD_BATCH);
        if (!todo.length) return 0;
        const json = await api.cards(todo.map(e => e.entry.id));
        const byId = new Map((json?.items || []).map(it => [it?.character_id, it]));
        const f = filters();
        for (const e of todo) {
            e.hydrated = true;
            e.card = normalizeCard(byId.get(e.entry.id));
            e.filtered = !passesFilters(e.card, f);
            if (e.filtered && e.card) {
                if (e.card.nsfw && f.showNsfw !== true) hidden.nsfw += 1;
                else hidden.small += 1;
            }
        }
        return todo.length;
    }

    /** Ensure at least `ahead` visible cards past the current one, fetching slates and cards as needed. */
    async function fill(ahead = 2) {
        const startSlates = slatesLoaded;
        for (;;) {
            const vis = visible();
            const pos = active ? vis.findIndex(v => v.entry.id === active.entry.id) : -1;
            if (vis.length - 1 - pos >= ahead) return;
            if (entries.some(e => !e.hydrated)) { await hydrate(); continue; }
            if (slatesLoaded - startSlates >= MAX_SLATES_PER_FILL) return;
            if (!(await loadSlate())) return;
        }
    }

    async function leave() {
        if (!active) return;
        const dwell = now() - active.at;
        const p = cardEventPayloads(active.entry, active.slate, active.card.creatorId, dwell);
        await emit('feed.character.dwell.ended', p.dwell);
        if (!active.engaged) await emit('feed.character.skipped', p.skipped);
        active = null;
    }

    async function show(i) {
        const vis = visible();
        if (i < 0 || i >= vis.length) return null;
        if (active?.entry.id === vis[i].entry.id) return active.card;
        await leave();
        index = i;
        const v = vis[i];
        active = { at: now(), entry: v.entry, slate: v.slate, card: v.card, engaged: false };
        await emit('feed.character.shown', cardEventPayloads(v.entry, v.slate, v.card.creatorId, 0).shown);
        if (session) session.shown += 1;
        return v.card;
    }

    return {
        async start() { await fill(2); return show(0); },
        async next() { await fill(2); return show(index + 1); },
        async prev() { return show(index - 1); },
        goTo: (i) => show(i),
        cards: () => visible().map(v => v.card),
        loadMore: (ahead = 5) => fill(ahead),
        current: () => active?.card || null,
        position: () => ({ index, loaded: visible().length, hasMore: hasMore || entries.some(e => !e.hydrated), personalizing, hidden: { ...hidden }, scanned: entries.filter(e => e.hydrated).length }),
        markEngaged() { if (active) active.engaged = true; },
        async notInterested() {
            if (!active) return null;
            const { entry, slate } = active;
            active.engaged = true;
            if (sendSignals()) {
                await emit('feed.character.not_interested', cardEventPayloads(entry, slate, active.card.creatorId, 0).notInterested);
                await api.notInterested(entry.id, entry.impressionId).catch(() => {});
            }
            const e = entries.find(x => x.entry.id === entry.id);
            if (e) e.filtered = true;
            await leave();
            await fill(2);
            return show(Math.min(index, visible().length - 1));
        },
        async end() {
            await leave();
            if (session) {
                await emit('feed.session.ended', { cards_shown: session.shown, duration_ms: Math.max(0, now() - session.started), surface_id: SURFACE_ID });
                session = null;
            }
            await flush();
        },
        isQuickSkip: (ms) => ms < QUICK_SKIP_MS,
    };
}
