// Janitor For You, server half: one Hosted Browser consumer for janitorai.com, limited to the recsys API.
// The page half does the fetching (ctx.browser.fetch); this half only registers the consumer and reports
// whether it exists, so the view can say why it is unavailable instead of failing on the first request.

export function register(router, ctx) {
    const state = { available: false, reason: '', consumer: null };
    try {
        state.consumer = ctx.browser.consumer({
            name: 'janitor',
            origin: 'https://janitorai.com',
            // only the recommender: home, cards, personalization, events, feedback
            fetchPrefix: '/hampter/recsys/',
            warmPath: '/',
        });
        state.available = true;
    } catch (e) {
        state.reason = `The JanitorAI feed is unavailable (${e.message})`;
        console.warn(`[janitor-foryou] ${state.reason}`);
    }

    router.get('/status', (req, res) => {
        res.json({ available: state.available, reason: state.reason, consumer: state.consumer });
    });
}

export const migrations = [];
