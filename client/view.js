// The For you view: one card at a time, like the site. Scaffold UI: card, Prev / Next / Not interested,
// Open on JanitorAI. Import goes through the JanitorAI provider's own preview later (see README "Next steps").
import { createApi } from './api.js';
import { createFeed } from './core/feed.js';
import { fillNameMacros } from './core/recsys.js';

let purifyConfig = null;
async function loadPurifyConfig() {
    if (purifyConfig) return purifyConfig;
    try { purifyConfig = (await import('/modules/providers/provider-utils.js')).BROWSE_PURIFY_CONFIG || {}; }
    catch { purifyConfig = {}; }
    return purifyConfig;
}

const fmt = (n) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);

export function mountView(el, ctx) {
    const esc = (s) => ctx.CoreAPI.escapeHtml(String(s ?? ''));
    const root = document.createElement('div');
    root.className = 'jfy-root';
    el.innerHTML = '';
    el.appendChild(root);

    const api = createApi(ctx);
    let feed = null;
    let busy = Promise.resolve();
    let disposed = false;
    let personaName = '';
    const readPersona = async () => {
        try { personaName = String((await ctx.CoreAPI.syncActivePersonaName?.()) || ''); } catch { personaName = ''; }
    };
    // names go into HTML, so they are escaped first; pronoun macros answered from the persona as a chat would
    const macros = (html, card) => {
        const out = fillNameMacros(html, { user: esc(personaName), char: esc(card.chatName) });
        try { return ctx.CoreAPI.answerPronounMacros?.(out, ctx.CoreAPI.getPersonaPronouns?.()) ?? out; } catch { return out; }
    };

    const newFeed = () => createFeed(api, {
        filters: () => ({ showNsfw: ctx.settings.get('showNsfw') === true, minTokens: Number(ctx.settings.get('minTokens')) || 0 }),
        sendSignals: () => ctx.settings.get('sendSignals') === true,
    });

    function message(text, kind = 'info', extra = '') {
        root.innerHTML = `<div class="jfy-message jfy-${kind}"><p>${esc(text)}</p><div class="jfy-message-actions">${extra}
            <button type="button" class="glass-btn" data-act="retry"><i class="fa-solid fa-rotate"></i> Try again</button></div></div>`;
    }

    // nothing passed the filters: say what was hidden and why, instead of "nothing left"
    function emptyState() {
        const { hidden = {}, scanned = 0 } = feed?.position() || {};
        const hiddenTotal = (hidden.nsfw || 0) + (hidden.small || 0);
        if (!scanned || !hiddenTotal) return message('Nothing left in your feed right now.');
        const parts = [];
        if (hidden.nsfw) parts.push(`${hidden.nsfw} NSFW (Show NSFW is off)`);
        if (hidden.small) parts.push(`${hidden.small} under ${Number(ctx.settings.get('minTokens')) || 0} tokens`);
        const buttons = [
            hidden.nsfw ? '<button type="button" class="glass-btn" data-act="show-nsfw"><i class="fa-solid fa-eye"></i> Show NSFW</button>' : '',
            hidden.small ? '<button type="button" class="glass-btn" data-act="no-min"><i class="fa-solid fa-filter-circle-xmark"></i> Show small bots</button>' : '',
        ].join('');
        message(`Your filters hid all ${scanned} recommendations so far: ${parts.join(', ')}.`, 'info', buttons);
    }

    async function render(card) {
        if (disposed) return;
        if (!card) { emptyState(); return; }
        const pos = feed.position();
        const cfg = await loadPurifyConfig();
        const html = macros(card.descriptionHtml, card);
        const desc = ctx.CoreAPI.safePurify(html, cfg) || esc(html);
        const tags = [...card.tags, ...card.customTags.map(t => `#${t}`)].slice(0, 14);
        root.innerHTML = `
        <div class="jfy-card">
            <div class="jfy-media">${card.avatar ? `<img src="${esc(card.avatar + (card.avatar.includes('?') ? '&' : '?') + 'width=600')}" alt="" referrerpolicy="no-referrer">` : ''}</div>
            <div class="jfy-body">
                <h2 class="jfy-name">${esc(card.name)}</h2>
                <div class="jfy-creator">@${esc(card.creatorName)}${card.creatorVerified ? ' <i class="fa-solid fa-circle-check" title="Verified"></i>' : ''} · ${fmt(card.followers)} followers</div>
                <div class="jfy-stats">
                    <span title="Chats"><i class="fa-regular fa-comments"></i> ${fmt(card.chats)}</span>
                    <span title="Favorites"><i class="fa-regular fa-heart"></i> ${fmt(card.favorites)}</span>
                    <span title="Tokens"><i class="fa-solid fa-coins"></i> ${fmt(card.tokens)}</span>
                    ${card.nsfw ? '<span class="jfy-nsfw">NSFW</span>' : ''}
                    ${card.showDefinition ? '' : '<span title="The creator hides the definition"><i class="fa-solid fa-eye-slash"></i> hidden</span>'}
                </div>
                <div class="jfy-tags">${tags.map(t => `<span class="jfy-tag">${esc(t)}</span>`).join('')}</div>
                <div class="jfy-desc">${desc}</div>
            </div>
        </div>
        <div class="jfy-bar">
            <button type="button" class="glass-btn" data-act="prev" ${pos.index <= 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i> Previous</button>
            <button type="button" class="glass-btn" data-act="nope" title="Not interested"><i class="fa-solid fa-ban"></i></button>
            <a class="glass-btn" data-act="open" href="${esc(card.url)}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-arrow-up-right-from-square"></i> JanitorAI</a>
            <button type="button" class="glass-btn" data-act="next">Next <i class="fa-solid fa-chevron-right"></i></button>
        </div>
        <div class="jfy-pos">${pos.index + 1} / ${pos.loaded}${pos.hasMore ? '+' : ''}${ctx.settings.get('sendSignals') === true ? ' · teaching the feed' : ''}</div>`;
    }

    function run(fn) {
        busy = busy.then(async () => {
            try { await render(await fn()); }
            catch (e) { if (!disposed) message(e.message || String(e), 'error'); }
        });
        return busy;
    }

    root.addEventListener('click', (ev) => {
        const act = ev.target.closest('[data-act]')?.dataset.act;
        if (!act || !feed) return;
        if (act === 'next') run(() => feed.next());
        else if (act === 'prev') run(() => feed.prev());
        else if (act === 'nope') run(() => feed.notInterested());
        else if (act === 'open') feed.markEngaged();
        else if (act === 'retry') { api.resetStatus(); start(); }
        else if (act === 'show-nsfw') { ctx.settings.set('showNsfw', true); start(); }
        else if (act === 'no-min') { ctx.settings.set('minTokens', 0); start(); }
    });

    function start() {
        root.innerHTML = '<div class="jfy-message"><p>Loading your feed…</p></div>';
        feed = newFeed();
        return run(async () => { await readPersona(); return feed.start(); });
    }

    return {
        enter() { if (!feed) start(); },
        leave() { feed?.end(); },
        refresh() { feed?.end(); feed = null; start(); },
        dispose() { disposed = true; feed?.end(); feed = null; root.remove(); },
    };
}
