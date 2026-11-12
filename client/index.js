// Janitor For You: JanitorAI's personalized "For you" feed inside Sigma.
import { mountView } from './view.js';

const VIEW = 'ext:janitor-foryou/foryou';
let view = null;

export default {
    init(ctx) {
        ctx.ui.contribute('app.action', {
            id: 'foryou',
            label: 'Janitor For You',
            icon: 'fa-wand-magic-sparkles',
            when: ({ view: v } = {}) => v !== VIEW,
            run: () => ctx.commands.run('view.switch', { view: VIEW }),
        });

        ctx.ui.contribute('shell.view', {
            id: 'foryou',
            label: 'For You',
            icon: 'fa-wand-magic-sparkles',
            render(el) { view = mountView(el, ctx); },
            enter: () => view?.enter(),
            leave: () => view?.leave(),
            refresh: () => view?.refresh(),
        });

        ctx.ui.addSettingsSection((body) => {
            const root = document.createElement('div');
            body.innerHTML = '';
            body.appendChild(root);
            const on = (k) => ctx.settings.get(k) === true;
            root.innerHTML = `
                <label class="jfy-setting"><input type="checkbox" class="cl-switch-input" data-k="sendSignals" ${on('sendSignals') ? 'checked' : ''}><span class="cl-switch"></span>
                    Teach the feed (send views, skips and "not interested" to JanitorAI, as the site does)</label>
                <label class="jfy-setting"><input type="checkbox" class="cl-switch-input" data-k="showNsfw" ${on('showNsfw') ? 'checked' : ''}><span class="cl-switch"></span>
                    Show NSFW characters</label>
                <label class="jfy-setting">Hide characters under <input type="number" min="0" step="50" class="glass-input jfy-num" data-k="minTokens" value="${Number(ctx.settings.get('minTokens')) || 0}"> tokens</label>`;
            root.addEventListener('change', (ev) => {
                const k = ev.target.dataset.k;
                if (!k) return;
                ctx.settings.set(k, ev.target.type === 'checkbox' ? ev.target.checked : Math.max(0, Number(ev.target.value) || 0));
            });
        });
    },

    dispose() {
        view?.dispose();
        view = null;
    },
};
