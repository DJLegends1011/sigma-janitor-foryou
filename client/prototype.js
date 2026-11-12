// PROTOTYPE, throwaway (branch prototype/ui-variants). Question: "What should the For You view look like?"
// Variants inside the real shell view (sub-shape A), switchable from the floating bar, ← / → keys, or
// ?jfy-variant=A|B|D. Read-only: Import / Not interested only toast. Live feed data, stub cards if it fails.
// Round 1 verdict: C (queue + detail) rejected; B kept as an optional "grid" setting; A liked. D added: a
// Sigma-styled vertical swipe feed (TikTok-like).
import { createApi } from './api.js';
import { parseSlate, normalizeCard, fillNameMacros, CARD_BATCH } from './core/recsys.js';

const VARIANTS = [
    { key: 'A', name: 'Spotlight' },
    { key: 'B', name: 'Grid (optional setting)' },
    { key: 'D', name: 'Swipe feed' },
];
const PARAM = 'jfy-variant';

const STUB_BASE = {
    name: 'Maki Zenin | Succubus Series | JJK part', chatName: 'Maki Zenin', creatorName: 'Myrandomaccount', creatorVerified: false, followers: 4104,
    tags: ['👩‍🦰 Female', '📚 Fictional', '📺 Anime', '🔮 Magical', '❤️‍🩹 Fluff', '🌗 Switch'], customTags: ['jujutstukaisen', 'makizenin'],
    tokens: 2380, nsfw: false, proxy: true, showDefinition: true, chats: 1343, messages: 4127, favorites: 390, comments: 3,
    avatar: 'https://ella.janitorai.com/bot-avatars/-Mcem38Wk_eq33H9p2p2H.webp', createdAt: '2026-02-16T04:05:53Z',
    descriptionHtml: '<p>"Damn it, {{user}}... This curse is a pain in the ass, but you\'re the only one I\'d let deal with it."</p><p>Story: On Valentine\'s Day, {{char}} is hit by a lingering curse from a defeated spirit…</p>',
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
const sized = (url, w) => url ? url + (url.includes('?') ? '&' : '?') + `width=${w}` : '';

export function mountPrototype(el, ctx) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./prototype.css', import.meta.url).href;
    document.head.appendChild(link);
    const esc = (s) => ctx.CoreAPI.escapeHtml(String(s ?? ''));
    const root = document.createElement('div');
    root.className = 'jfy-proto';
    el.innerHTML = '';
    el.appendChild(root);

    const api = createApi(ctx);
    let cards = [];
    let source = 'loading';
    let selected = 0;
    let cursor = '';
    let hasMore = true;
    let loading = null;
    let disposed = false;
    let persona = '';
    let observer = null;
    let cleanups = [];
    const seen = new Set();

    // the native online preview's own path (renderCreatorNotesSecure): formatRichText(text, charName, true) answers
    // {{user}} / {{char}} / pronouns as .placeholder-user / .placeholder-char spans; fallback: plain names
    const desc = (c) => {
        let h = '';
        try { h = ctx.CoreAPI.formatRichText?.(c.descriptionHtml, c.chatName, true) || ''; } catch { h = ''; }
        if (!h) {
            h = fillNameMacros(c.descriptionHtml, { user: esc(persona), char: esc(c.chatName) });
            try { h = ctx.CoreAPI.answerPronounMacros?.(h, ctx.CoreAPI.getPersonaPronouns?.()) ?? h; } catch { /* raw */ }
        }
        return ctx.CoreAPI.safePurify(h, {}) || esc(h);
    };

    // one slate, hydrated three at a time (the API's cap)
    function loadMore() {
        if (loading || !hasMore || source.startsWith('STUB')) return loading;
        loading = (async () => {
            try {
                if (!persona) { try { persona = String((await ctx.CoreAPI.syncActivePersonaName?.()) || ''); } catch { /* none */ } }
                const slate = parseSlate(await api.home({ cursor }), seen);
                cursor = slate.cursor;
                hasMore = !!cursor && slate.items.length > 0;
                const ids = slate.items.map(i => i.id);
                for (let i = 0; i < ids.length; i += CARD_BATCH) {
                    const json = await api.cards(ids.slice(i, i + CARD_BATCH));
                    const got = (json?.items || []).map(normalizeCard).filter(Boolean);
                    if (got.length) { cards.push(...got); source = 'live'; appendOrPaint(); }
                }
            } catch (e) {
                if (!cards.length) { cards = stubCards(); source = `STUB (live feed failed: ${e.message})`; paint(); }
                hasMore = false;
            } finally {
                if (!cards.length) { cards = stubCards(); source = 'STUB (feed was empty)'; paint(); }
                loading = null;
            }
        })();
        return loading;
    }

    const tagsHtml = (c, n = 8) => [...c.tags, ...c.customTags.map(t => `#${t}`)].slice(0, n).map(t => `<span class="jfy-tag">${esc(t)}</span>`).join('');
    const statsHtml = (c) => `<span><i class="fa-regular fa-comments"></i> ${fmt(c.chats)}</span><span><i class="fa-regular fa-heart"></i> ${fmt(c.favorites)}</span><span><i class="fa-solid fa-coins"></i> ${fmt(c.tokens)}</span>${c.nsfw ? '<span class="jfy-nsfw">NSFW</span>' : ''}`;

    // A: one big card, prev/next
    function variantA() {
        const c = cards[selected];
        return `<div class="jfyA">
            <div class="jfyA-hero">${c.avatar ? `<img src="${esc(sized(c.avatar, 800))}" alt="" referrerpolicy="no-referrer">` : ''}<div class="jfyA-over"><h2>${esc(c.name)}</h2><div>@${esc(c.creatorName)} · ${fmt(c.followers)} followers</div></div></div>
            <div class="jfyA-meta"><div class="jfy-stats">${statsHtml(c)}</div><div class="jfy-tags">${tagsHtml(c, 12)}</div><div class="jfyA-desc">${desc(c)}</div></div>
            <div class="jfyA-bar">
                <button class="glass-btn" data-act="prev" ${selected ? '' : 'disabled'}><i class="fa-solid fa-chevron-left"></i></button>
                <button class="glass-btn" data-act="noop"><i class="fa-solid fa-ban"></i> Not interested</button>
                <button class="glass-btn" data-act="noop"><i class="fa-solid fa-file-import"></i> Import</button>
                <button class="glass-btn" data-act="next"><i class="fa-solid fa-chevron-right"></i></button>
            </div></div>`;
    }

    // B: native Online grid cards; the image wrapper gets .loaded on load, which is what ends the native shimmer
    const gridCard = (c, i) => `
        <div class="browse-card" data-pick="${i}" title="${esc(c.name)}">
            <div class="browse-card-image">${c.avatar ? `<img src="${esc(sized(c.avatar, 400))}" alt="" referrerpolicy="no-referrer" onload="this.parentElement.classList.add('loaded')" onerror="this.parentElement.classList.add('loaded');this.src='/img/no-portrait.png'">` : ''}${c.nsfw ? '<span class="browse-nsfw-badge">NSFW</span>' : ''}</div>
            <div class="browse-card-body"><div class="browse-card-name">${esc(c.name)}</div><span class="browse-card-creator-link">${esc(c.creatorName)}</span>
                <div class="jfy-tags">${tagsHtml(c, 3)}</div></div>
            <div class="browse-card-footer"><span class="browse-card-stat"><i class="fa-solid fa-comments"></i> ${fmt(c.chats)}</span><span class="browse-card-stat"><i class="fa-solid fa-coins"></i> ${fmt(c.tokens)}</span></div>
        </div>`;
    const variantB = () => `<div class="browse-grid jfyB">${cards.map(gridCard).join('')}</div>
        <div class="jfyB-note">Click a card: for now it opens that card in Spotlight; the real build opens the JanitorAI preview.</div>`;

    // D: vertical swipe feed. One full-height slide per character, snap scrolling, actions on a right rail.
    const slide = (c, i) => `
        <section class="jfyD-slide" data-i="${i}" aria-label="${esc(c.name)}">
            <div class="jfyD-stage">
                <img class="jfyD-portrait" src="${esc(sized(c.avatar, 900))}" alt="" referrerpolicy="no-referrer" loading="${i < 3 ? 'eager' : 'lazy'}" decoding="async"
                    onload="this.parentElement.classList.add('loaded')" onerror="this.parentElement.classList.add('loaded','failed')">
            </div>
            <div class="jfyD-scrim"></div>
            <div class="jfyD-dim"></div>
            <div class="jfyD-info">
                <div class="jfyD-creator"><button type="button" class="jfyD-handle" data-act="creator" data-name="${esc(c.creatorName)}" title="See all characters by ${esc(c.creatorName)}">@${esc(c.creatorName)}</button>${c.creatorVerified ? ' <i class="fa-solid fa-circle-check"></i>' : ''}<span class="jfyD-dot">·</span>${fmt(c.followers)} followers</div>
                <h2 class="jfyD-name">${esc(c.name)}</h2>
                <div class="jfyD-desc" data-act="expand"><div class="jfyD-desc-inner">${desc(c)}</div></div>
                <div class="jfyD-tags">${[...c.tags, ...c.customTags.map(t => `#${t}`)].slice(0, 6).map(t => `<button type="button" class="jfy-tag" data-act="tag" data-tag="${esc(t)}" title="Browse ${esc(t)} on JanitorAI">${esc(t)}</button>`).join('')}</div>
            </div>
            <nav class="jfyD-rail" aria-label="Actions">
                <button type="button" data-act="noop" aria-label="Import"><i class="fa-solid fa-file-import"></i><span>Import</span></button>
                <a class="jfyD-open" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open on JanitorAI" title="Open on JanitorAI"><i class="fa-solid fa-external-link"></i><span>Open</span></a>
                <button type="button" data-act="noop" aria-label="Favorites"><i class="fa-regular fa-heart"></i><span>${fmt(c.favorites)}</span></button>
                <button type="button" data-act="noop" aria-label="Chats"><i class="fa-regular fa-comments"></i><span>${fmt(c.chats)}</span></button>
                <button type="button" data-act="expand" aria-label="Details"><i class="fa-solid fa-coins"></i><span>${fmt(c.tokens)}</span></button>
                <button type="button" data-act="noop" aria-label="Not interested"><i class="fa-solid fa-ban"></i><span>Pass</span></button>
            </nav>
            ${c.nsfw ? '<span class="jfyD-nsfw">NSFW</span>' : ''}
        </section>`;
    const endHtml = () => hasMore ? '<i class="fa-solid fa-spinner fa-spin"></i>' : 'You are all caught up.';
    // one shared backdrop behind the whole feed (two layers), cross-faded by scroll position, like TikTok:
    // per-slide backdrops always meet at a seam because each slide clips its own
    const variantD = () => `<div class="jfyD-wrap"><div class="jfyD-bg" aria-hidden="true"><div class="jfyD-bg-layer"></div><div class="jfyD-bg-layer"></div></div>
        <div class="jfyD" tabindex="0">${cards.map(slide).join('')}<div class="jfyD-end">${endHtml()}</div></div></div>`;

    function wireD() {
        const feedEl = root.querySelector('.jfyD');
        if (!feedEl) return;
        // fill the whole view (over its padding), so no app background shows around the feed
        const host = feedEl.closest('.gallery-content');
        root.classList.toggle('jfy-fill', !!host);
        if (host) host.scrollTop = 0;
        else {
            const fit = () => { const top = feedEl.getBoundingClientRect().top; feedEl.style.height = `${Math.max(360, window.innerHeight - top)}px`; };
            fit();
            window.addEventListener('resize', fit);
            cleanups.push(() => window.removeEventListener('resize', fit));
        }
        // backdrop: layer 0 shows the slide at floor(position), layer 1 the next one, faded in by the fraction
        const layers = root.querySelectorAll('.jfyD-bg-layer');
        // the backdrop uses the portrait's own URL (900w): one download serves both, and the portrait preload covers it
        const bgUrl = (i) => cards[i]?.avatar ? sized(cards[i].avatar, 900) : '';
        const bgOf = (i) => bgUrl(i) ? `url("${bgUrl(i).replace(/"/g, '%22')}")` : 'none';
        const warmed = new Set();
        const warm = (i) => {
            const u = bgUrl(i);
            if (!u || warmed.has(u)) return;
            warmed.add(u);
            const im = new Image();
            im.referrerPolicy = 'no-referrer';
            im.decoding = 'async';
            im.src = u;
        };
        // ping-pong: even slides always live on layer 0, odd on layer 1. The layer you're looking at never
        // changes its picture; only the hidden one (opacity 0) is re-pointed, so the blur never re-rasters on screen
        const shown = [null, null];
        let raf = 0;
        const setImg = (L, i) => { const v = bgOf(i); if (shown[L] !== v) { layers[L].style.backgroundImage = v; shown[L] = v; } };
        const paintBg = () => {
            raf = 0;
            const h = feedEl.clientHeight || 1;
            const pos = Math.max(0, feedEl.scrollTop / h);
            const a = Math.min(Math.floor(pos), Math.max(0, cards.length - 1));
            const frac = Math.min(1, Math.max(0, pos - a));
            const La = a % 2, Lb = 1 - La;
            setImg(La, a);
            layers[La].style.opacity = '1'; layers[La].style.zIndex = '0';
            layers[Lb].style.zIndex = '1'; layers[Lb].style.opacity = String(frac);
            setImg(Lb, a + 1); // hidden at frac 0, so swapping it is invisible
        };
        const onScroll = () => { if (!raf) raf = requestAnimationFrame(paintBg); };
        feedEl.addEventListener('scroll', onScroll, { passive: true });
        cleanups.push(() => { feedEl.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); });
        observer = new IntersectionObserver((entries) => {
            for (const en of entries) {
                if (!en.isIntersecting) continue;
                selected = Number(en.target.dataset.i);
                for (let k = 0; k <= 3; k++) warm(selected + k);
                for (let k = 1; k <= 3; k++) {
                    const img = feedEl.querySelector(`.jfyD-slide[data-i="${selected + k}"] .jfyD-portrait`);
                    if (img && img.loading !== 'eager') img.loading = 'eager';
                }
                if (cards.length - selected <= 3) loadMore();
            }
        }, { root: feedEl, threshold: 0.6 });
        feedEl.querySelectorAll('.jfyD-slide').forEach(s => observer.observe(s));
        const at = feedEl.querySelector(`.jfyD-slide[data-i="${selected}"]`);
        if (at) feedEl.scrollTop = at.offsetTop;
        for (let k = 0; k <= 3; k++) warm(selected + k);
        paintBg();
        feedEl.focus({ preventScroll: true });
    }

    // a batch landing in D appends slides instead of repainting (keeps the scroll position)
    function appendOrPaint() {
        const feedEl = currentVariant() === 'D' && root.querySelector('.jfyD');
        if (!feedEl) return paint();
        const have = feedEl.querySelectorAll('.jfyD-slide').length;
        const end = feedEl.querySelector('.jfyD-end');
        for (let i = have; i < cards.length; i++) {
            end.insertAdjacentHTML('beforebegin', slide(cards[i], i));
            observer?.observe(feedEl.querySelector(`.jfyD-slide[data-i="${i}"]`));
        }
        end.innerHTML = endHtml();
    }

    function paint() {
        if (disposed) return;
        cleanups.forEach(f => f()); cleanups = [];
        observer?.disconnect(); observer = null;
        const v = currentVariant();
        const meta = VARIANTS.find(x => x.key === v);
        const body = !cards.length ? '<p class="jfy-message">Loading…</p>' : v === 'B' ? variantB() : v === 'D' ? variantD() : variantA();
        root.classList.toggle('is-d', v === 'D');
        if (v !== 'D') root.classList.remove('jfy-fill');
        root.innerHTML = `<div class="jfy-proto-source">PROTOTYPE · data: ${esc(source)}${persona ? ` · {{user}} = ${esc(persona)}` : ''}</div>${body}
            <div class="jfy-proto-switch" role="toolbar">
                <button type="button" data-sw="-1" aria-label="Previous variant">‹</button>
                <span>${esc(v)} (${esc(meta.name)})</span>
                <button type="button" data-sw="1" aria-label="Next variant">›</button>
            </div>`;
        if (v === 'D' && cards.length) wireD();
    }

    function cycle(d) {
        const i = VARIANTS.findIndex(x => x.key === currentVariant());
        setVariant(VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length].key);
        paint();
    }

    function stepD(d) {
        const feedEl = root.querySelector('.jfyD');
        const to = feedEl?.querySelector(`.jfyD-slide[data-i="${Math.max(0, Math.min(cards.length - 1, selected + d))}"]`);
        if (!to) return;
        const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
        feedEl.scrollTo({ top: to.offsetTop, behavior: smooth ? 'smooth' : 'auto' });
        // a throttled or hidden page can drop a smooth scroll; land it anyway
        if (smooth) setTimeout(() => { if (Math.abs(feedEl.scrollTop - to.offsetTop) > 4) feedEl.scrollTop = to.offsetTop; }, 650);
    }

    root.addEventListener('click', (ev) => {
        const sw = ev.target.closest('[data-sw]');
        if (sw) return cycle(Number(sw.dataset.sw));
        const pick = ev.target.closest('[data-pick]');
        if (pick) { selected = Number(pick.dataset.pick); setVariant('A'); return paint(); }
        const act = ev.target.closest('[data-act]')?.dataset.act;
        if (act === 'next') { selected = Math.min(cards.length - 1, selected + 1); if (cards.length - selected <= 3) loadMore(); paint(); }
        else if (act === 'prev') { selected = Math.max(0, selected - 1); paint(); }
        else if (act === 'expand') ev.target.closest('.jfyD-slide')?.classList.toggle('is-open');
        else if (act === 'noop') ctx.CoreAPI.showToast?.('Prototype: not wired', 'info');
        else if (act === 'creator' || act === 'tag') {
            const el = ev.target.closest('[data-act]');
            const what = act === 'creator' ? `characters by ${el.dataset.name}` : `the ${el.dataset.tag} tag`;
            ctx.CoreAPI.showToast?.(`Would open Online > JanitorAI with ${what} (needs a Sigma door to open Online pre-filtered)`, 'info');
        }
    });

    const onKey = (ev) => {
        if (!root.isConnected || ev.target.closest?.('input, textarea, select, [contenteditable]')) return;
        if (ev.key === 'ArrowLeft') cycle(-1);
        else if (ev.key === 'ArrowRight') cycle(1);
        else if (currentVariant() === 'D' && (ev.key === 'ArrowDown' || ev.key === 'j')) { ev.preventDefault(); stepD(1); }
        else if (currentVariant() === 'D' && (ev.key === 'ArrowUp' || ev.key === 'k')) { ev.preventDefault(); stepD(-1); }
    };
    document.addEventListener('keydown', onKey);

    return {
        enter() { if (!cards.length) { paint(); loadMore(); } else paint(); },
        leave() {},
        refresh() { cards = []; seen.clear(); cursor = ''; hasMore = true; selected = 0; source = 'loading'; paint(); loadMore(); },
        dispose() { disposed = true; cleanups.forEach(f => f()); observer?.disconnect(); document.removeEventListener('keydown', onKey); link.remove(); root.remove(); },
    };
}
