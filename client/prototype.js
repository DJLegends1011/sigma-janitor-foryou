// PROTOTYPE, throwaway (branch prototype/ui-variants). Question: "What should the For You view look like?"
// Three structurally different variants inside the real shell view (sub-shape A), switchable from a floating bar,
// ← / → keys, or ?jfy-variant=A|B|C in the URL. Read-only: no imports, no signals. Real feed data when it loads,
// otherwise stub cards built from the captured live card (labelled STUB).
import { createApi } from './api.js';
import { parseSlate, normalizeCard } from './core/recsys.js';

const VARIANTS = [
    { key: 'A', name: 'Spotlight (one card, like the site)' },
    { key: 'B', name: 'Grid (native Online browse cards)' },
    { key: 'C', name: 'Queue + detail (split pane)' },
];
const PARAM = 'jfy-variant';

const STUB_BASE = {
    name: 'Maki Zenin | Succubus Series | JJK part', creatorName: 'Myrandomaccount', creatorVerified: false, followers: 4104,
    tags: ['👩‍🦰 Female', '📚 Fictional', '📺 Anime', '🔮 Magical', '❤️‍🩹 Fluff', '🌗 Switch'], customTags: ['jujutstukaisen', 'makizenin'],
    tokens: 2380, nsfw: false, proxy: true, showDefinition: true, chats: 1343, messages: 4127, favorites: 390, comments: 3,
    avatar: 'https://ella.janitorai.com/bot-avatars/-Mcem38Wk_eq33H9p2p2H.webp', createdAt: '2026-02-16T04:05:53Z',
    descriptionHtml: '<p>"Damn it, {{user}}... This curse is a pain in the ass, but you\'re the only one I\'d let deal with it."</p><p>Story: On Valentine\'s Day, Maki Zen\'in is hit by a lingering curse from a defeated spirit…</p>',
};
const stubCards = () => Array.from({ length: 9 }, (_, i) => ({
    ...STUB_BASE, id: `stub-${i}`, name: `${STUB_BASE.name} #${i + 1}`, tokens: 400 + i * 700, chats: 120 * (i + 1),
    url: 'https://janitorai.com/', stub: true,
}));

const fmt = (n) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
const currentVariant = () => {
    const v = new URLSearchParams(location.search).get(PARAM);
    return VARIANTS.some(x => x.key === v) ? v : 'A';
};
function setVariant(key) {
    const u = new URL(location.href);
    u.searchParams.set(PARAM, key);
    history.replaceState(history.state, '', u);
}

export function mountPrototype(el, ctx) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./prototype.css', import.meta.url).href;
    document.head.appendChild(link);
    const esc = (s) => ctx.CoreAPI.escapeHtml(String(s ?? ''));
    const purify = (h) => ctx.CoreAPI.safePurify(h, {}) || esc(h);
    const root = document.createElement('div');
    root.className = 'jfy-proto';
    el.innerHTML = '';
    el.appendChild(root);

    let cards = [];
    let source = 'loading';
    let selected = 0;
    let disposed = false;

    async function load() {
        const api = createApi(ctx);
        try {
            const slate = parseSlate(await api.home({}));
            const ids = slate.items.slice(0, 12).map(i => i.id);
            const json = ids.length ? await api.cards(ids) : { items: [] };
            cards = (json.items || []).map(normalizeCard).filter(Boolean);
            source = cards.length ? 'live' : 'empty';
        } catch (e) {
            cards = stubCards();
            source = `STUB (live feed failed: ${e.message})`;
        }
        if (!cards.length) { cards = stubCards(); source = 'STUB (feed was empty)'; }
        paint();
    }

    const tagsHtml = (c, n = 8) => [...c.tags, ...c.customTags.map(t => `#${t}`)].slice(0, n).map(t => `<span class="jfy-tag">${esc(t)}</span>`).join('');
    const statsHtml = (c) => `<span><i class="fa-regular fa-comments"></i> ${fmt(c.chats)}</span><span><i class="fa-regular fa-heart"></i> ${fmt(c.favorites)}</span><span><i class="fa-solid fa-coins"></i> ${fmt(c.tokens)}</span>${c.nsfw ? '<span class="jfy-nsfw">NSFW</span>' : ''}`;
    const img = (c, w) => c.avatar ? `<img src="${esc(c.avatar + (c.avatar.includes('?') ? '&' : '?') + 'width=' + w)}" alt="" referrerpolicy="no-referrer">` : '';

    // A: one big card, prev/next; the site's own interaction model
    function variantA() {
        const c = cards[selected];
        return `<div class="jfyA">
            <div class="jfyA-hero">${img(c, 800)}<div class="jfyA-over"><h2>${esc(c.name)}</h2><div>@${esc(c.creatorName)} · ${fmt(c.followers)} followers</div></div></div>
            <div class="jfyA-meta"><div class="jfy-stats">${statsHtml(c)}</div><div class="jfy-tags">${tagsHtml(c, 12)}</div><div class="jfyA-desc">${purify(c.descriptionHtml)}</div></div>
            <div class="jfyA-bar">
                <button class="glass-btn" data-act="prev" ${selected ? '' : 'disabled'}><i class="fa-solid fa-chevron-left"></i></button>
                <button class="glass-btn" data-act="noop"><i class="fa-solid fa-ban"></i> Not interested</button>
                <button class="glass-btn" data-act="noop"><i class="fa-solid fa-file-import"></i> Import</button>
                <button class="glass-btn" data-act="next"><i class="fa-solid fa-chevron-right"></i></button>
            </div></div>`;
    }

    // B: the native Online grid; the feed becomes a sort order rather than a mode
    function variantB() {
        return `<div class="browse-grid jfyB">${cards.map((c, i) => `
            <div class="browse-card" data-pick="${i}" title="${esc(c.name)}">
                <div class="browse-card-image">${img(c, 400)}${c.nsfw ? '<span class="browse-nsfw-badge">NSFW</span>' : ''}</div>
                <div class="browse-card-body"><div class="browse-card-name">${esc(c.name)}</div><span class="browse-card-creator-link">${esc(c.creatorName)}</span>
                    <div class="jfy-tags">${tagsHtml(c, 3)}</div></div>
                <div class="browse-card-footer"><span class="browse-card-stat"><i class="fa-solid fa-comments"></i> ${fmt(c.chats)}</span><span class="browse-card-stat"><i class="fa-solid fa-coins"></i> ${fmt(c.tokens)}</span></div>
            </div>`).join('')}</div>
            <div class="jfyB-note">Click a card → would open the JanitorAI provider's own preview (import, duplicate check).</div>`;
    }

    // C: a queue on the left, the selected card's full detail on the right; stacks on a phone
    function variantC() {
        const c = cards[selected];
        return `<div class="jfyC">
            <ol class="jfyC-queue">${cards.map((x, i) => `<li class="${i === selected ? 'is-on' : ''}" data-pick="${i}">${img(x, 96)}<div><b>${esc(x.name)}</b><small>${fmt(x.tokens)} tok · ${fmt(x.chats)} chats</small></div></li>`).join('')}</ol>
            <section class="jfyC-detail">
                <div class="jfyC-head">${img(c, 300)}<div><h2>${esc(c.name)}</h2><div>@${esc(c.creatorName)}</div><div class="jfy-stats">${statsHtml(c)}</div>
                    <div class="jfyC-actions"><button class="glass-btn" data-act="noop"><i class="fa-solid fa-file-import"></i> Import</button><button class="glass-btn" data-act="noop"><i class="fa-solid fa-ban"></i></button></div></div></div>
                <div class="jfy-tags">${tagsHtml(c, 14)}</div><div class="jfyC-desc">${purify(c.descriptionHtml)}</div>
            </section></div>`;
    }

    function paint() {
        if (disposed) return;
        const v = currentVariant();
        const meta = VARIANTS.find(x => x.key === v);
        const body = !cards.length ? '<p class="jfy-message">Loading…</p>' : v === 'B' ? variantB() : v === 'C' ? variantC() : variantA();
        root.innerHTML = `<div class="jfy-proto-source">PROTOTYPE · data: ${esc(source)}</div>${body}
            <div class="jfy-proto-switch" role="toolbar">
                <button type="button" data-sw="-1" aria-label="Previous variant">‹</button>
                <span>${esc(v)} (${esc(meta.name)})</span>
                <button type="button" data-sw="1" aria-label="Next variant">›</button>
            </div>`;
    }

    function cycle(d) {
        const i = VARIANTS.findIndex(x => x.key === currentVariant());
        setVariant(VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length].key);
        paint();
    }

    root.addEventListener('click', (ev) => {
        const sw = ev.target.closest('[data-sw]');
        if (sw) return cycle(Number(sw.dataset.sw));
        const pick = ev.target.closest('[data-pick]');
        if (pick) { selected = Number(pick.dataset.pick); if (currentVariant() === 'B') setVariant('A'); return paint(); }
        const act = ev.target.closest('[data-act]')?.dataset.act;
        if (act === 'next') { selected = Math.min(cards.length - 1, selected + 1); paint(); }
        else if (act === 'prev') { selected = Math.max(0, selected - 1); paint(); }
        else if (act === 'noop') ctx.CoreAPI.showToast?.('Prototype: not wired', 'info');
    });

    const onKey = (ev) => {
        if (!root.isConnected || ev.target.closest?.('input, textarea, select, [contenteditable]')) return;
        if (ev.key === 'ArrowLeft') cycle(-1);
        else if (ev.key === 'ArrowRight') cycle(1);
    };
    document.addEventListener('keydown', onKey);

    return {
        enter() { if (!cards.length) load(); else paint(); },
        leave() {},
        refresh() { cards = []; selected = 0; load(); },
        dispose() { disposed = true; document.removeEventListener('keydown', onKey); link.remove(); root.remove(); },
    };
}
