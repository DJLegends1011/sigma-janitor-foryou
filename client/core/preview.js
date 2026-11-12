// STOPGAP — the only place this extension touches Sigma internals for preview readiness.
// p.browseView._initialized and window.ProviderRegistry.activateProvider /
// deactivateCurrentProvider / getActiveProviderId are private (app/modules/providers/provider-registry.js).
// Some providers wire Close/Import/backdrop only on browse initialization. Replace this helper with
// the public door requested in 'Online Browse - Extension Content Modes'. Cold activation rebuilds
// Online's DOM, resets the previous provider's search/scroll on its next visit, and starts a browse request.
// Fail safe, including activation that throws or stalls; never open a half-wired preview.
export async function stopgapReadyProviderPreview(p, {
    window = globalThis.window, document = globalThis.document, timeoutMs = 8000,
} = {}) {
    const reason = 'Open this site in the Online tab once, then try the preview again.';
    let timer;
    let registry;
    try {
        const view = p?.browseView;
        if (!view || view._initialized === true) return { ok: true };
        registry = window?.ProviderRegistry;
        const pane = document?.getElementById('onlineCharactersPane');
        const filters = document?.getElementById('onlineCharactersFilter');
        if (typeof registry?.activateProvider !== 'function' ||
            typeof registry?.deactivateCurrentProvider !== 'function' ||
            typeof registry?.getActiveProviderId !== 'function' || !pane || !filters) return { ok: false, reason };
        await Promise.race([
            registry.activateProvider(p.id, pane, filters, { kind: 'characters' }),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Preview activation timed out')), timeoutMs); }),
        ]);
        if (view._initialized !== true || registry.getActiveProviderId() !== p.id) return { ok: false, reason };
        return { ok: true };
    } catch {
        return { ok: false, reason };
    } finally {
        clearTimeout(timer);
        try {
            const online = document?.getElementById('onlineView');
            if (registry?.getActiveProviderId?.() === p.id && (!online || online.classList.contains('hidden'))) {
                registry.deactivateCurrentProvider?.();
            }
        } catch { /* readiness must never throw, including cleanup */ }
    }
}
