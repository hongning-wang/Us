# Us

Create personalized videos inside a two-person Instagram DM. A WXT/Svelte extension talks to a local SvelteKit server, Honcho stores pair memory, native `codex exec` writes the scene specification, and Seeddance generates the video.

## Run

1. Use Node 22+, Chrome, and a signed-in Codex CLI. Run `npm install`.
2. Copy `.env.example` to `.env` **only if `.env` does not already exist**. Set `HONCHO_API_KEY` and `SEEDANCE_API_KEY`. Keys stay on the server.
3. Run `npm run dev` (127.0.0.1:5173). This also serves an interactive, fixture-only preview.
4. Run `npm run build -w @us/extension`. Open `chrome://extensions`, enable Developer mode, and load `apps/extension/.output/chrome-mv3` unpacked. Reload Instagram after extension updates.
5. Open any one-to-one DM, type `/us` with an idea, choose your photo, and confirm **Yes, that’s me**. This confirmation is saved for that Instagram identity. Optional replacement is under `/us settings` → **Change photo**. Resetting chat memory preserves the photo.
6. For real generation, run `npm run dev:media` and expose **port 5174** through an HTTPS tunnel. For Cloudflare: `cloudflared tunnel --url http://127.0.0.1:5174`. Set `PUBLIC_MEDIA_BASE` to the printed HTTPS origin and restart `npm run dev`. The media proxy serves only `/api/media/:filename`; keep the application server local.

The first text request imports up to **500 messages from the past three calendar months**, stopping at whichever boundary comes first (or the conversation beginning). Completed imports are reused across reloads, including chats with fewer than 500 messages; new visible messages sync incrementally with deduplication. `/us settings` → **Import more** retries incomplete imports. The collector reads message timestamps and native Instagram date separators; messages whose date cannot be established are skipped, and missing dates or stalled loading keep a partial import labeled incomplete. Reels and videos are excluded and do not count toward the cap. Text keeps slang and emoji while tracking parameters and temporary CDN links are removed. History ingestion does not download, transcribe, or visually analyze Reels. The 500-message cap limits the initial backfill, not the lifetime count as new messages arrive. Existing Honcho memories are not retroactively deleted by the cutoff. **Reset memory** starts a fresh pair session for a clean reimport; it does not delete the old remote session, photos, jobs, or sent messages.

## Demo

Follow [the single-account demo script](docs/demo.md). The current provider is [Seeddance](https://www.seeddance.io/docs), model `seedance-2.5`. Requests use five seconds at 480p. A selected video is an explicit scene reference; starting a fresh idea clears it. Confirmed identity photos remain available in every mode, and the unconfirmed friend's likeness is omitted.

An ambiguous generation submission is never automatically repeated. Polling resumes the stored provider task. Completed videos auto-send through Instagram’s native attachment control. Delivery records its state before native upload/Send; uncertain uploads are checked before another send is allowed. A prerecorded fallback is explicitly labeled and is not evidence that live generation works.

The backend uses Supabase Postgres with eleven relational tables in the **public** schema: `accounts`, `chats`, `chat_participants`, `identity_photos`, `chat_reference_photos`, `history_imports`, `imported_messages`, `memory_sessions`, `stories`, `jobs`, and `media_assets`. See [the database design](docs/database.md). Foreign keys connect records; uniqueness constraints prevent duplicate requests and history imports. Photos, reference uploads, and generated video bytes are stored in `media_assets` in Supabase; Honcho stores relationship messages. No runtime state uses a local `data/` directory.

Set `DATABASE_URL` and run `npm run db:migrate` before starting the backend. TLS certificate verification is enabled. Postgres is required for normal operation—there is no local JSON storage fallback. Tests use an explicitly selected in-memory test store and mocked generation APIs.

Us reads the logged-in identity and current chat from Instagram. Photos belong to that account; history and jobs are scoped to account + chat. In a Reel share dialog, select one person and choose **Make this us** beside Instagram's Send button. Optional text in the share message field becomes the instruction in that person's DM. Press Enter to generate; no recipient is fixed in code.

## Running it on another computer

For the current developer demo, each tester needs this repo, Node, Chrome, the unpacked extension, and a configured running backend. Follow the Run steps with their own backend/provider credentials; never distribute `.env` or your database password.

The public backend URL can be baked into an extension build:

```sh
VITE_US_API_BASE=https://your-backend.example.com npm run build -w @us/extension
```

This configures both requests and extension host permissions. A hosted consumer release is **not deployed**: it still needs backend hosting, authenticated users with server-enforced ownership, and hosted media storage. Supabase persistence alone does not provide those. The current API is intended to remain local; account/chat namespacing prevents accidental mixing but is not an authentication boundary.

## Checks

```sh
npm run check
npm test
npm run build
# With npm run dev already running:
node scripts/test-ui.mjs
npm run test:e2e
```

Tests use isolated storage and fake providers; they do not purchase generations. `npm run test:e2e` starts a local HTTP mock endpoint, drives the actual extension content script against a simulated Instagram page, and closes the endpoint when finished. It covers text, selected Reel, continuation, Share → DM, refresh recovery, the Reel-shaped generating placeholder, and automatic attachment delivery. It verifies the uploaded file bytes match the returned MP4. All browser requests are intercepted; no real Instagram messages or generation requests are sent.

For manual API development, `npm run dev:mock` serves the same mock at `http://127.0.0.1:5175`. It supports `/api/setup`, `/api/history`, `/api/jobs`, `/api/jobs/:id/delivery`, and `/api/media/fixture.mp4`; `GET /__mock` shows captured requests and job state. Jobs progress from generating to ready and use a labeled prerecorded clip. This separate process does not load `.env`, invoke Codex, or contact Honcho/Seeddance. It does not change the installed extension's live backend. This tests the UI/bridge contract; backend and provider request mapping are tested separately with `npm test`. The browser UI check uses the installed macOS Chrome path. `scripts/chrome.mjs` and `scripts/reload-extension.mjs` are optional macOS development helpers requiring Chrome's “Allow JavaScript from Apple Events”.

See [verification status](docs/verification.md) for tested behavior and remaining live checks. Single-account testing does not verify the recipient's extension or account.

Fixture: `apps/web/static/fixture.mp4` is the MDN flower video from https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4 (CC0), used only as a labeled prerecorded demo and upload fixture.

Photo setup offers the current participant’s Instagram profile photo and up to six recent post images. Suggestions load from an inactive profile tab, which closes after reading. A profile photo that loads at 300px or better is selected automatically for one-tap confirmation; otherwise setup prompts for upload. Post images remain a manual choice. No facial recognition or vision API runs. Upload remains available when Instagram does not expose usable images. Your self-confirmed photo is reused across chats. An optional friend photo is saved only for the selected chat, records who selected it, and never marks the friend’s own account as photo-confirmed. Generation receives the sender as `@image1` and the selected friend as `@image2`. Run `npm run db:migrate` after pulling schema changes.
