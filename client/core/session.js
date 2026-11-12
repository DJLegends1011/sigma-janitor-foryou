// STOPGAP: the JanitorAI session.
// The recommender answers 401 without `Authorization: Bearer <access token>`. Sigma's built-in JanitorAI provider
// already holds that token (Settings > Online > JanitorAI, stored as the first-party setting `janitoraiToken`
// and refreshed by app/modules/providers/janitor-session.js `getValidJanitoraiToken`). No documented door hands an
// extension a provider's session, so this one helper reads the stored token through ctx.CoreAPI.getSetting and
// refuses an expired one rather than refreshing it (the refresh token is single-use; racing core's refresh would
// log the user out). Replace with a "provider session" door if Reaper adds one.
//
// Internals touched: the setting key `janitoraiToken` (app/library.js default, app/settings-modal.js UI).

const EXPIRY_MARGIN_MS = 60_000;

export function decodeExpiry(jwt) {
    try {
        const part = String(jwt).split('.')[1];
        if (!part) return 0;
        let b = part.replace(/-/g, '+').replace(/_/g, '/');
        while (b.length % 4) b += '=';
        const json = JSON.parse(typeof atob === 'function' ? atob(b) : Buffer.from(b, 'base64').toString('utf8'));
        return Number(json.exp) > 0 ? Number(json.exp) * 1000 : 0;
    } catch { return 0; }
}

/** @returns {{ ok: true, token: string } | { ok: false, reason: 'no-api' | 'signed-out' | 'expired' }} */
export function stopgapJanitorToken(ctx, now = Date.now()) {
    const get = ctx?.CoreAPI?.getSetting;
    if (typeof get !== 'function') return { ok: false, reason: 'no-api' };
    let token = '';
    try { token = String(get('janitoraiToken') || ''); } catch { return { ok: false, reason: 'no-api' }; }
    if (!token) return { ok: false, reason: 'signed-out' };
    const exp = decodeExpiry(token);
    if (exp && exp - now < EXPIRY_MARGIN_MS) return { ok: false, reason: 'expired' };
    return { ok: true, token };
}

export const SESSION_HELP = {
    'no-api': 'This version of Sigma does not expose the JanitorAI session to extensions.',
    'signed-out': 'Sign in to JanitorAI under Settings > Online > JanitorAI first.',
    expired: 'Your JanitorAI session needs a refresh: open JanitorAI in the Online tab once, then come back.',
};
