// Pure helpers for JanitorAI's recommender API (no DOM, no ctx) so they can be unit-tested.
// Wire format as observed in the site's own client (recsys module, x-app-version 10.0.0.191):
//   GET  /hampter/recsys/home?limit=20&shape=ids[&cursor=]   -> { items[{character_id, impression_id, position, rec_source}], next_cursor, model_version, personalization, request_id, surface_id }
//   GET  /hampter/recsys/home/cards?ids=a,b[&content_locale=] -> { items[{ character, character_id, favorite_count, comment_count, ... }] }
//   GET  /hampter/recsys/home/personalization                 -> { status: 'ready' | 'pending' }
//   POST /hampter/recsys/events   { events: [envelope] }
//   POST /hampter/recsys/home/feedback { character_id, impression_id }   ("Not interested")

export const RECSYS_PREFIX = '/hampter/recsys/';
export const SURFACE_ID = 'home_feed';
export const SLATE_SIZE = 20;
export const CARD_BATCH = 3; // the API refuses more: 400 "ids must contain no more than 3 elements" (the site sends 2)
export const QUICK_SKIP_MS = 2000;
export const MAX_EVENT_PAYLOAD = 4096;
export const AVATAR_BASE = 'https://ella.janitorai.com/bot-avatars/';
export const SITE = 'https://janitorai.com';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s) => typeof s === 'string' && UUID_RE.test(s);

export function homePath({ limit = SLATE_SIZE, cursor = '' } = {}) {
    const q = new URLSearchParams({ limit: String(Math.max(1, Math.min(50, limit | 0 || SLATE_SIZE))), shape: 'ids' });
    if (cursor) q.set('cursor', String(cursor));
    return `${RECSYS_PREFIX}home?${q}`;
}

export function cardsPath(ids, locale = '') {
    const clean = (ids || []).filter(isUuid);
    if (!clean.length) throw new Error('cardsPath: no valid ids');
    if (clean.length > CARD_BATCH) throw new Error(`cardsPath: at most ${CARD_BATCH} ids per request`);
    const q = new URLSearchParams({ ids: clean.join(',') });
    if (locale) q.set('content_locale', String(locale));
    return `${RECSYS_PREFIX}home/cards?${q}`;
}

export const personalizationPath = () => `${RECSYS_PREFIX}home/personalization`;
export const eventsPath = () => `${RECSYS_PREFIX}events`;
export const feedbackPath = () => `${RECSYS_PREFIX}home/feedback`;

/** A home slate, de-duplicated against ids already seen or dismissed. */
export function parseSlate(json, seen = new Set()) {
    const items = [];
    for (const it of Array.isArray(json?.items) ? json.items : []) {
        if (!isUuid(it?.character_id) || seen.has(it.character_id)) continue;
        seen.add(it.character_id);
        items.push({
            id: it.character_id,
            impressionId: String(it.impression_id || ''),
            position: Number(it.position) || 0,
            recSource: String(it.rec_source || ''),
        });
    }
    return {
        items,
        cursor: typeof json?.next_cursor === 'string' ? json.next_cursor : '',
        modelVersion: String(json?.model_version || ''),
        requestId: String(json?.request_id || ''),
        personalization: String(json?.personalization || ''),
    };
}

export function avatarUrl(name, width = 0) {
    if (!name || typeof name !== 'string') return '';
    let url = /^https:\/\//i.test(name) ? name : AVATAR_BASE + encodeURIComponent(name);
    if (width) url += (url.includes('?') ? '&' : '?') + `width=${width | 0}`;
    return url;
}

export function slugify(s) {
    return String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 80) || 'character';
}

export const characterUrl = (id, name) => `${SITE}/characters/${id}_character-${slugify(name)}`;

/** One hydrated card, trimmed to what the view shows. Unknown shapes answer null. */
export function normalizeCard(item) {
    const c = item?.character;
    if (!c || !isUuid(c.id) || c.is_deleted || c.is_force_remove || c.is_public === false) return null;
    return {
        id: c.id,
        name: String(c.name || 'Unnamed'),
        chatName: String(c.chat_name || '').trim() || String(c.name || '').split('|')[0].trim(),
        avatar: avatarUrl(c.avatar),
        descriptionHtml: String(c.description || ''),
        creatorId: String(c.creator_id || ''),
        creatorName: String(c.creator_name || ''),
        creatorVerified: !!c.creator_verified,
        followers: Number(item.creator_profile?.followers_count) || 0,
        tags: (Array.isArray(c.tags) ? c.tags : []).map(t => String(t?.name || '')).filter(Boolean),
        customTags: (Array.isArray(c.custom_tags) ? c.custom_tags : []).map(String),
        tokens: Number(c.total_tokens) || 0,
        nsfw: c.is_nsfw === true,
        proxy: c.is_proxy_enabled === true,
        showDefinition: c.showdefinition !== false,
        chats: Number(c.stats?.chat) || 0,
        messages: Number(c.stats?.message) || 0,
        favorites: Number(item.favorite_count) || 0,
        comments: Number(item.comment_count) || 0,
        createdAt: String(c.first_published_at || c.created_at || ''),
        url: characterUrl(c.id, c.name),
    };
}

/**
 * {{user}} / {{char}} in display text, answered the way a chat would: the active Sigma persona's name and the
 * character's chat name. Case-insensitive like Sigma's own macros; a missing name leaves the macro as written.
 * Pronoun macros are left for CoreAPI.answerPronounMacros (the caller applies it after this).
 */
export function fillNameMacros(text, { user = '', char = '' } = {}) {
    let out = String(text ?? '');
    if (user) out = out.replace(/\{\{\s*user\s*\}\}/gi, user);
    if (char) out = out.replace(/\{\{\s*char\s*\}\}/gi, char);
    return out;
}

/** Client-side filters on top of the recommender (it has no NSFW or size knobs of its own). */
export function passesFilters(card, { showNsfw = false, minTokens = 0 } = {}) {
    if (!card) return false;
    if (card.nsfw && showNsfw !== true) return false;
    if (minTokens > 0 && card.tokens < minTokens) return false;
    return true;
}

let counter = 0;
export function uuid() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    counter += 1;
    return `00000000-0000-4000-8000-${String(Date.now() + counter).padStart(12, '0').slice(-12)}`;
}

/** The site's event envelope (schema_version 1). Throws on an oversized payload, as the site refuses it. */
export function makeEvent(name, payload, sessionId, now = Date.now()) {
    if (JSON.stringify(payload ?? {}).length > MAX_EVENT_PAYLOAD) throw new Error(`recsys event ${name} payload exceeds size limit`);
    return { client_ts: now, event_id: uuid(), name, payload: payload ?? {}, platform: 'web', schema_version: 1, session_id: sessionId };
}

/** Payloads for the per-card events, from a slate entry and the slate it came from. */
export function cardEventPayloads(entry, slate, creatorId, dwellMs) {
    const base = { character_id: entry.id, impression_id: entry.impressionId, position: entry.position, request_id: slate.requestId };
    return {
        shown: { ...base, creator_id: creatorId, model_version: slate.modelVersion, rec_source: entry.recSource, surface_id: SURFACE_ID },
        dwell: { ...base, dwell_ms: Math.max(0, Math.round(dwellMs || 0)) },
        skipped: { ...base, dwell_ms: Math.max(0, Math.round(dwellMs || 0)), rec_source: entry.recSource, surface_id: SURFACE_ID },
        notInterested: { ...base, rec_source: entry.recSource },
    };
}
