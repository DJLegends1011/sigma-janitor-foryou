# Janitor For You (Project Σ extension)

> **Status: scaffold (0.0.1).** Browsing works against the live API shape; import is not wired yet (see Next steps).

JanitorAI's personalized **For you** feed (`janitorai.com/?segment=discover`, `/foru/<id>`) inside Sigma: one recommended
character at a time, with Previous / Next / Not interested, the same way the site shows it.

## Requirements
- Project Σ with extension API **2.7** (Hosted Browser consumer door).
- Signed in to JanitorAI in Sigma (**Settings > Online > JanitorAI**). The feed is per-account; logged out there is none.
- Hosted Browser set up (**Settings > Online > Hosted Browser**); janitorai.com is behind a firewall that blocks plain requests.

## What it reads, writes and sends
- **Reads:** your JanitorAI session token from Sigma's own JanitorAI login (setting `janitoraiToken`), only to put it in
  the `Authorization` header of the requests below. It never stores or logs it.
- **Writes:** its three settings (`sendSignals`, `showNsfw`, `minTokens`). Nothing in your library.
- **Sends**, through the Hosted Browser, to `https://janitorai.com/hampter/recsys/` only:
  - `GET home` (the recommended ids), `GET home/cards` (their cards), `GET home/personalization` (a new account's readiness).
  - Only with **Teach the feed** on (off by default): `POST events` (card shown, time spent, skipped, session start/end)
    and `POST home/feedback` (Not interested), the same signals the website sends, so your feed on the site changes too.

## Settings
| Key | Default | Meaning |
|---|---|---|
| `sendSignals` | `false` | Send view/skip/not-interested signals like the site does |
| `showNsfw` | `false` | Show cards JanitorAI marks NSFW (only an explicit `true` opts in) |
| `minTokens` | `100` | Hide cards under this many tokens (filters out "announcement" bots) |

## How a new account's feed starts (observed in the site's client)
1. A new profile has `tag_preferences.status: "pending"`; the site redirects to `/onboarding?step=interests`, an
   "interests wall" where you pick tags (or skip). Saved with `PATCH /hampter/profiles/mine/tag-preferences`
   `{ tag_ids, custom_tags, status }`. Older accounts read `"not_required"`.
2. The first `GET recsys/home` may answer `personalization: "pending"`; the client polls `home/personalization` up to
   4 × 1 s, then asks again. This extension does the same.
3. After that it learns from the events above, plus chats started from the feed (`recsys_context` on chat create).

## Next steps
- Import / preview: hand a card to the JanitorAI provider's own preview (definition fetch + duplicate check) rather than
  a parallel import path; likely the same stopgap pattern as Collections until a door exists.
- Decide placement: the skill rule is "online browsing lives in the Online tab"; a For you *kind* on the JanitorAI provider
  would need a core door (kinds are hard-coded), so this ships as a shell view for now.
- `session.js` is a STOPGAP (reads the core JanitorAI token, never refreshes it). Candidate feature request: a provider-session door.

## Tests
`node --test test/` from this folder (uses `D:/ProjectSigma-main` or `SIGMA_DIR` for the lint check).

## License
MIT © DJLegends
