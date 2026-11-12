import { createApi } from './api.js';
import { createFeed } from './core/feed.js';
import { fillNameMacros, backdropPlan, avatarUrl } from './core/recsys.js';
import { stopgapReadyProviderPreview } from './core/preview.js';

let purifyConfig;
async function loadPurifyConfig() {
    if (purifyConfig) return purifyConfig;
    try { purifyConfig = (await import('/modules/providers/provider-utils.js')).BROWSE_PURIFY_CONFIG || {}; }
    catch { purifyConfig = {}; }
    return purifyConfig;
}
const fmt = n => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);

export function mountView(el, ctx) {
    const esc = s => ctx.CoreAPI.escapeHtml(String(s ?? ''));
    const root = document.createElement('div');
    root.className = 'jfy-root';
    el.innerHTML = '';
    el.appendChild(root);
    const api = createApi(ctx);
    const toast = (text, kind = 'info') => ctx.CoreAPI.showToast?.(text, kind);
    const minTokens = () => Number(ctx.settings.get('minTokens') ?? 100) || 0;
    let feed, scroller, observer, layers;
    let cards = [], selected = 0, persona = '', layout = 'swipe';
    let disposed = false, entered = false, generation = 0, loading = false, previewPending = false;
    let busy = Promise.resolve(), raf = 0, scrollTimer = 0;
    let loadError = '';
    const warmed = new Map();
    const shown = [null, null];

    // Serialize paging, observer callbacks and actions so dwell bookkeeping cannot race.
    function run(fn, token = generation) {
        busy = busy.then(async () => {
            if (disposed || token !== generation) return;
            try { await fn(); }
            catch (e) { if (!disposed && token === generation) showError(e); }
        });
        return busy;
    }
    function disconnect() {
        observer?.disconnect(); observer = null;
        scroller?.removeEventListener('scroll', onScroll);
        cancelAnimationFrame(raf); raf = 0;
        clearTimeout(scrollTimer);
        scroller = null; layers = null;
    }
    function message(text, kind = 'info', extra = '') {
        disconnect();
        root.innerHTML = `<div class="jfy-message jfy-${kind}"><p>${esc(text)}</p><div class="jfy-message-actions">${extra}<button type="button" class="glass-btn" data-act="retry">Try again</button></div></div>`;
    }
    function showError(e) {
        loadError = e.message || String(e);
        if (cards.length && scroller) updateEnd();
        else message(loadError, 'error');
    }
    function emptyState() {
        const { hidden = {}, scanned = 0 } = feed.position();
        if (!scanned || !(hidden.nsfw + hidden.small)) return message('Nothing left in your feed right now.');
        const reasons = [];
        if (hidden.nsfw) reasons.push(`${hidden.nsfw} NSFW (Show NSFW is off)`);
        if (hidden.small) reasons.push(`${hidden.small} under ${minTokens()} tokens`);
        message(`Your filters hid all ${scanned} recommendations so far: ${reasons.join(', ')}.`, 'info',
            `${hidden.nsfw ? '<button type="button" class="glass-btn" data-act="show-nsfw">Show NSFW</button>' : ''}${hidden.small ? '<button type="button" class="glass-btn" data-act="no-min">Show small bots</button>' : ''}`);
    }
    function description(card) {
        let html = '';
        try { html = ctx.CoreAPI.formatRichText?.(card.descriptionHtml, card.chatName, true) || ''; } catch { /* fallback */ }
        if (!html) {
            html = fillNameMacros(card.descriptionHtml, { user: esc(persona), char: esc(card.chatName) });
            try { html = ctx.CoreAPI.answerPronounMacros?.(html, ctx.CoreAPI.getPersonaPronouns?.()) ?? html; } catch { /* names still answered */ }
        }
        return ctx.CoreAPI.safePurify(html, purifyConfig || {}) || esc(html);
    }
    const tags = c => [...c.tags, ...c.customTags.map(t => `#${t}`)];
    const tagHtml = (c, count, buttons = true) => tags(c).slice(0, count).map(t => buttons
        ? `<button type="button" class="jfy-tag" data-act="tag">${esc(t)}</button>`
        : `<span class="jfy-tag">${esc(t)}</span>`).join('');
    const creatorImage = c => c.creatorAvatar ? `<img class="jfy-creator-avatar" src="${esc(c.creatorAvatar)}" referrerpolicy="no-referrer" loading="lazy" alt="">` : '';
    function slide(c, i) {
        return `<section class="jfy-slide" data-id="${esc(c.id)}" data-i="${i}" aria-label="${esc(c.name)}">
            <div class="jfy-stage"><img class="jfy-portrait" src="${esc(avatarUrl(c.avatar, 900))}" alt="" referrerpolicy="no-referrer" loading="${i <= selected + 3 ? 'eager' : 'lazy'}" decoding="async">${c.nsfw ? '<span class="jfy-nsfw">NSFW</span>' : ''}</div>
            <div class="jfy-scrim"></div><div class="jfy-dim"></div>
            <div class="jfy-info">
                <div class="jfy-creator"><button type="button" class="jfy-handle" data-act="creator">${creatorImage(c)}@${esc(c.creatorName)}</button>${c.creatorVerified ? '<i class="fa-solid fa-circle-check" aria-label="Verified"></i>' : ''}<span class="jfy-dot">·</span>${fmt(c.followers)} followers</div>
                <h2 class="jfy-name">${esc(c.name)}</h2>
                <div class="jfy-desc" data-act="expand" role="button" tabindex="0" aria-expanded="false"><div class="jfy-desc-inner">${description(c)}</div></div>
                <div class="jfy-tags">${tagHtml(c, 6)}</div>
            </div>
            <nav class="jfy-rail" aria-label="Actions">
                <button type="button" data-act="import" aria-label="Import"><i class="fa-solid fa-file-import"></i><span>Import</span></button>
                <a href="${esc(c.url)}" data-act="open" target="_blank" rel="noopener noreferrer" aria-label="Open on JanitorAI"><i class="fa-solid fa-external-link"></i><span>Open</span></a>
                <span class="jfy-stat" aria-label="Favorites"><i class="fa-regular fa-heart"></i><span>${fmt(c.favorites)}</span></span>
                <span class="jfy-stat" aria-label="Chats"><i class="fa-regular fa-comments"></i><span>${fmt(c.chats)}</span></span>
                <button type="button" data-act="expand" aria-label="Toggle description"><i class="fa-solid fa-coins"></i><span>${fmt(c.tokens)}</span></button>
                <button type="button" data-act="pass" aria-label="Not interested"><i class="fa-solid fa-ban"></i><span>Pass</span></button>
            </nav></section>`;
    }
    function gridCard(c, i) {
        return `<div class="browse-card jfy-grid-card" data-id="${esc(c.id)}" data-i="${i}" data-act="import" role="button" tabindex="0" aria-label="Preview ${esc(c.name)}">
            <div class="browse-card-image">${c.avatar ? `<img src="${esc(avatarUrl(c.avatar, 400))}" alt="" referrerpolicy="no-referrer" loading="lazy">` : ''}${c.nsfw ? '<span class="browse-nsfw-badge">NSFW</span>' : ''}</div>
            <div class="browse-card-body"><div class="browse-card-name">${esc(c.name)}</div><span class="browse-card-creator-link jfy-grid-creator">${creatorImage(c)}${esc(c.creatorName)}</span><div class="jfy-tags">${tagHtml(c, 3, false)}</div></div>
            <div class="browse-card-footer"><span class="browse-card-stat"><i class="fa-solid fa-comments"></i> ${fmt(c.chats)}</span><span class="browse-card-stat"><i class="fa-solid fa-coins"></i> ${fmt(c.tokens)}</span></div></div>`;
    }
    function updateEnd() {
        const end = root.querySelector('.jfy-end');
        if (!end) return;
        end.innerHTML = loadError ? `<span class="jfy-error">${esc(loadError)}</span><button type="button" class="glass-btn" data-act="retry">Try again</button>`
            : loading || feed.position().hasMore ? '<i class="fa-solid fa-spinner fa-spin" aria-label="Loading more"></i>' : 'You are all caught up.';
    }
    function fit() {
        if (!scroller) return;
        const host = el.closest('.gallery-content');
        root.classList.toggle('jfy-fill', !!host);
        const wrap = root.querySelector('.jfy-wrap');
        if (!host && wrap) wrap.style.height = `${Math.max(1, window.innerHeight - wrap.getBoundingClientRect().top)}px`;
        scheduleScroll();
    }
    function warm(i) {
        if (layout !== 'swipe') return;
        for (let k = i; k <= i + 3; k++) {
            const c = cards[k];
            if (!c) continue;
            const url = avatarUrl(c.avatar, 900);
            if (url && !warmed.has(url)) {
                const image = new Image(); image.referrerPolicy = 'no-referrer'; image.decoding = 'async'; image.src = url;
                warmed.set(url, image);
                while (warmed.size > 12) warmed.delete(warmed.keys().next().value); // the browser cache keeps the bytes
            }
            const img = scroller?.querySelector(`[data-i="${k}"] .jfy-portrait`);
            if (img) img.loading = 'eager';
        }
    }
    function paintBackdrop() {
        if (!layers || !scroller) return;
        const plan = backdropPlan(scroller.scrollTop, scroller.clientHeight, cards.length);
        plan.slides.forEach((i, layer) => {
            const url = i === null ? '' : avatarUrl(cards[i]?.avatar, 900);
            if (shown[layer] !== url) {
                // Normal adjacent scrolling only changes the hidden layer. Hide explicitly on jumps too.
                layers[layer].style.opacity = '0';
                layers[layer].style.backgroundImage = url ? `url("${url.replace(/"/g, '%22')}")` : 'none';
                shown[layer] = url;
            }
        });
        layers[1 - plan.front].style.zIndex = '0'; layers[1 - plan.front].style.opacity = '1';
        layers[plan.front].style.zIndex = '1'; layers[plan.front].style.opacity = String(plan.frac);
    }
    function select(i) {
        if (!entered || !cards[i]) return;
        selected = i; warm(i);
        const id = cards[i].id;
        run(async () => {
            const at = feed.cards().findIndex(c => c.id === id);
            if (at >= 0) await feed.goTo(at);
        });
        if (layout === 'swipe' && cards.length - i <= 3) loadMore();
    }
    function scheduleScroll() { if (!raf) raf = requestAnimationFrame(onFrame); }
    function onScroll() { scheduleScroll(); }
    function onFrame() {
        raf = 0;
        if (!scroller || !entered) return;
        paintBackdrop();
        if (layout === 'grid' && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < scroller.clientHeight) loadMore();
        if (layout === 'swipe' && cards.length - selected <= 3) loadMore();
    }
    function setup() {
        disconnect();
        root.innerHTML = `<div class="jfy-wrap">${layout === 'swipe' ? '<div class="jfy-bg" aria-hidden="true"><div class="jfy-bg-layer"></div><div class="jfy-bg-layer"></div></div>' : ''}<div class="jfy-scroller jfy-${layout === 'grid' ? 'grid-scroll' : 'swipe'}" tabindex="0">${layout === 'grid' ? '<div class="browse-grid jfy-grid"></div>' : ''}<div class="jfy-end" role="status"></div></div></div>`;
        scroller = root.querySelector('.jfy-scroller');
        layers = layout === 'swipe' ? root.querySelectorAll('.jfy-bg-layer') : null;
        shown.fill(null);
        scroller.addEventListener('scroll', onScroll, { passive: true });
        observer = new IntersectionObserver(entries => {
            if (!entered) return;
            const visible = entries.filter(e => e.isIntersecting && e.intersectionRatio >= .6).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
            if (visible[0]) select(Number(visible[0].target.dataset.i));
        }, { root: scroller, threshold: .6 });
        const host = el.closest('.gallery-content');
        if (host) host.scrollTop = 0;
        fit();
    }
    // Keyed reconciliation retains slide nodes and expanded state; paging only appends.
    function sync() {
        if (disposed) return;
        cards = feed.cards();
        if (!cards.length) return emptyState();
        if (!scroller) setup();
        const container = layout === 'grid' ? root.querySelector('.jfy-grid') : scroller;
        const end = root.querySelector('.jfy-end');
        const scrollTop = scroller.scrollTop;
        const ids = new Set(cards.map(c => c.id));
        container.querySelectorAll('[data-id]').forEach(node => {
            if (!ids.has(node.dataset.id)) { observer?.unobserve(node); node.remove(); }
        });
        const existing = new Map([...container.querySelectorAll('[data-id]')].map(node => [node.dataset.id, node]));
        cards.forEach((c, i) => {
            let node = existing.get(c.id);
            if (!node) {
                const template = document.createElement('template');
                template.innerHTML = layout === 'grid' ? gridCard(c, i) : slide(c, i);
                node = template.content.firstElementChild;
                container.insertBefore(node, layout === 'grid' ? null : end);
                observer?.observe(node);
            }
            node.dataset.i = String(i);
        });
        root.querySelectorAll('img').forEach(img => { if (img.complete) imageReady({ target: img, type: img.naturalWidth ? 'load' : 'error' }); });
        root.querySelectorAll('.browse-card-image:not(:has(img))').forEach(node => node.classList.add('loaded'));
        selected = Math.max(0, Math.min(selected, cards.length - 1));
        // Inserting before a snapped end sentinel can re-anchor Chrome to that sentinel.
        // Restore the exact offset after layout, rather than allowing append to move the feed.
        scroller.scrollTop = scrollTop;
        warm(selected); updateEnd(); paintBackdrop(); scheduleScroll();
    }
    function loadMore() {
        if (loading || loadError || !feed?.position().hasMore || !entered) return;
        loading = true; updateEnd();
        const token = generation;
        run(async () => {
            try { await feed.loadMore(layout === 'grid' ? 12 : 5); }
            finally { if (token === generation) loading = false; }
            if (token === generation) sync();
        }, token);
    }
    function imageReady(ev) {
        const img = ev.target;
        if (img.tagName !== 'IMG') return;
        if (img.classList.contains('jfy-creator-avatar')) {
            if (ev.type === 'error') img.remove();
            return;
        }
        const box = img.closest('.jfy-stage, .browse-card-image');
        box?.classList.add('loaded');
        if (ev.type === 'error') box?.classList.add('failed');
    }
    function step(delta) {
        const to = Math.max(0, Math.min(cards.length - 1, selected + delta));
        const node = scroller?.querySelector(`[data-i="${to}"]`);
        if (!node) return;
        selected = to;
        clearTimeout(scrollTimer);
        const top = node.offsetTop;
        const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
        scroller.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
        if (smooth) scrollTimer = setTimeout(() => {
            if (scroller && Math.abs(scroller.scrollTop - top) > 4) scroller.scrollTop = top;
        }, 650);
    }
    const openOnlineFilter = () => toast('Opening Online on a creator/tag needs a Sigma feature (requested)');
    async function preview(card) {
        if (previewPending) return;
        previewPending = true;
        const token = generation;
        try {
            const p = ctx.CoreAPI.getProvider?.('janitorai');
            if (!p || (ctx.CoreAPI.getSetting?.('disabledProviders') || []).includes('janitorai')) {
                toast('Turn on JanitorAI under Settings > Online to preview in Sigma; opened the site instead.');
                window.open(card.url, '_blank', 'noopener,noreferrer');
                return;
            }
            const obj = await p.buildPreviewObject({ name: card.name, data: {} }, { id: card.id });
            if (disposed || !entered || token !== generation) return;
            const ready = await stopgapReadyProviderPreview(p);
            if (!ready.ok) return toast(ready.reason);
            if (!disposed && entered && token === generation) await p.openPreview(obj);
        } catch (e) { toast(e.message || String(e), 'error'); }
        finally { previewPending = false; }
    }
    function toggleDescription(node) {
        const slide = node.closest('.jfy-slide');
        if (!slide) return;
        const open = slide.classList.toggle('is-open');
        slide.querySelector('.jfy-desc')?.setAttribute('aria-expanded', String(open));
    }
    function onClick(ev) {
        const target = ev.target.closest('[data-act]');
        if (!target || !root.contains(target)) return;
        const act = target.dataset.act;
        const node = target.closest('[data-id]');
        const card = cards.find(c => c.id === node?.dataset.id);
        if (act === 'retry') { api.resetStatus(); start(); }
        else if (act === 'show-nsfw' || act === 'no-min') {
            ctx.settings.set(act === 'show-nsfw' ? 'showNsfw' : 'minTokens', act === 'show-nsfw' ? true : 0); start();
        } else if (act === 'expand') {
            if (ev.target.closest('a') && target.classList.contains('jfy-desc')) return;
            toggleDescription(target);
        } else if (act === 'creator' || act === 'tag') openOnlineFilter();
        else if (card && (act === 'open' || act === 'import')) {
            const actionFeed = feed;
            run(async () => { await actionFeed.goTo(actionFeed.cards().findIndex(c => c.id === card.id)); actionFeed.markEngaged(); });
            if (act === 'import') preview(card);
        } else if (card && act === 'pass') {
            const actionFeed = feed, token = generation;
            run(async () => {
                await actionFeed.goTo(actionFeed.cards().findIndex(c => c.id === card.id));
                await actionFeed.notInterested();
                if (disposed || token !== generation) return;
                selected = Math.max(0, actionFeed.position().index);
                sync();
                if (scroller) scroller.scrollTop = selected * scroller.clientHeight;
            }, token);
        }
    }
    function onKey(ev) {
        if (!entered || disposed || ev.target.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
        const action = ev.target.closest?.('.jfy-desc, .jfy-grid-card');
        if (action && root.contains(action) && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); action.click(); return; }
        if (layout !== 'swipe') return;
        // an open bio scrolls with the arrow keys; don't steal them for the feed
        if (ev.target.closest?.('.jfy-desc, .jfy-desc-inner')) return;
        if (ev.key === 'ArrowDown' || ev.key === 'j') { ev.preventDefault(); step(1); }
        else if (ev.key === 'ArrowUp' || ev.key === 'k') { ev.preventDefault(); step(-1); }
    }
    function start() {
        if (disposed) return;
        const oldFeed = feed;
        busy = busy.then(() => oldFeed?.end());
        generation++;
        loading = false; loadError = ''; cards = []; selected = 0;
        layout = ctx.settings.get('layout') === 'grid' ? 'grid' : 'swipe';
        disconnect();
        feed = createFeed(api, {
            filters: () => ({ showNsfw: ctx.settings.get('showNsfw') === true, minTokens: minTokens() }),
            sendSignals: () => ctx.settings.get('sendSignals') === true,
        });
        const nextFeed = feed, token = generation;
        root.innerHTML = '<div class="jfy-message"><p>Loading your feed…</p></div>';
        return run(async () => {
            try { persona = String((await ctx.CoreAPI.syncActivePersonaName?.()) || ''); } catch { persona = ''; }
            await loadPurifyConfig();
            await nextFeed.start();
            if (token === generation) sync();
        }, token);
    }
    root.addEventListener('click', onClick);
    root.addEventListener('load', imageReady, true);
    root.addEventListener('error', imageReady, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', fit);
    return {
        enter() {
            entered = true;
            if (!feed) return start();
            return run(async () => { await feed.goTo(selected); fit(); warm(selected); scheduleScroll(); });
        },
        leave() {
            entered = false; clearTimeout(scrollTimer);
            const leaving = feed;
            busy = busy.then(() => leaving?.end());
            return busy;
        },
        refresh() {
            if (entered) return start();
            const oldFeed = feed;
            generation++; feed = null; cards = []; disconnect();
            busy = busy.then(() => oldFeed?.end());
            return busy;
        },
        dispose() {
            disposed = true; entered = false; generation++;
            disconnect();
            const oldFeed = feed; busy.finally(() => oldFeed?.end());
            document.removeEventListener('keydown', onKey);
            window.removeEventListener('resize', fit);
            root.removeEventListener('click', onClick);
            root.removeEventListener('load', imageReady, true);
            root.removeEventListener('error', imageReady, true);
            warmed.clear(); root.remove();
        },
    };
}
