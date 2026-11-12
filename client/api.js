// Transport: every request goes through the Hosted Browser consumer the server half registered ('janitor'),
// so it carries the real browser's Cloudflare clearance. The bearer comes from the stopgap session helper.
import { homePath, cardsPath, personalizationPath, eventsPath, feedbackPath } from './core/recsys.js';
import { stopgapJanitorToken, SESSION_HELP } from './core/session.js';

const APP_VERSION = '10.0.0.191'; // the site's web client header; observed 2026-11-11

export class FeedError extends Error {
    constructor(message, code, status = 0) { super(message); this.code = code; this.status = status; }
}

export function createApi(ctx) {
    let status = null;

    async function ensure() {
        if (!status) status = await ctx.server.call('/status');
        if (!status.available) throw new FeedError(status.reason || 'The JanitorAI feed is unavailable', 'UNAVAILABLE');
    }

    async function call(path, { method = 'GET', jsonBody, signal } = {}) {
        await ensure();
        const s = stopgapJanitorToken(ctx);
        if (!s.ok) throw new FeedError(SESSION_HELP[s.reason], `SESSION_${s.reason.toUpperCase()}`);
        const r = await ctx.browser.fetch('janitor', path, {
            method,
            jsonBody,
            signal,
            timeoutMs: 20_000,
            headers: { Accept: 'application/json', Authorization: `Bearer ${s.token}`, 'x-app-version': APP_VERSION },
        });
        if (r.status === 401) throw new FeedError(SESSION_HELP.expired, 'SESSION_EXPIRED', 401);
        if (r.status === 403 || /<title>(Just a moment|.*Access Restricted)/i.test(r.body || '')) {
            throw new FeedError('JanitorAI blocked the Hosted Browser. Check it under Settings > Online > Hosted Browser.', 'BLOCKED', r.status);
        }
        if (r.status === 404) throw new FeedError('JanitorAI has no For you feed for this account.', 'NOT_FOUND', 404);
        if (r.status === 429) throw new FeedError(`JanitorAI is rate limiting requests.${r.retryAfter ? ` Retry after ${r.retryAfter}.` : ''}`, 'RATE_LIMITED', 429);
        if (r.status < 200 || r.status >= 300) throw new FeedError(`JanitorAI answered ${r.status || 'nothing'}`, 'HTTP', r.status);
        if (!r.body) return null;
        try { return JSON.parse(r.body); } catch { throw new FeedError('JanitorAI answered something that is not JSON', 'BAD_BODY', r.status); }
    }

    return {
        home: (opts, signal) => call(homePath(opts), { signal }),
        cards: (ids, locale, signal) => call(cardsPath(ids, locale), { signal }),
        personalization: (signal) => call(personalizationPath(), { signal }),
        events: (events) => call(eventsPath(), { method: 'POST', jsonBody: { events } }),
        notInterested: (characterId, impressionId) => call(feedbackPath(), { method: 'POST', jsonBody: { character_id: characterId, impression_id: impressionId } }),
        resetStatus: () => { status = null; },
    };
}
