# Verification status

## Local checks (no paid API calls)

- 44 automated tests pass (the obsolete local-file persistence test was removed). Both app/extension checks report zero errors/warnings, and the production build passes.
- The latest reference prompt defaults to identity substitution, preserves source action/setting/style, and excludes relationship-memory steering. Fresh text requests retain memory. This prompt change has not been rerendered against the paid API.
- Backend tests verify that the exact selected Reel URL and saved identity photo reach provider inputs. The adapter test verifies `video_urls` and `image_urls` in the outgoing JSON; the video is an actual media reference, not merely a link in the prompt.
- `npm run test:e2e` starts an isolated HTTP mock bridge. The actual extension content script runs against a simulated Instagram DOM, with all external browser requests intercepted. Text, selected Reel, own-video continuation, Share → DM navigation, and refresh recovery pass. Four mock requests produce four deliveries, with no duplicate job or send after refresh.
- The browser test verifies the unchanged native composer, focused prefilled shortcuts, automatic sending, no result modal, a 9:16 generating placeholder inside the message list, and removal after delivery. Uploaded MP4 bytes match the mock response by SHA-256.
- A separate mock browser check covers observation after incomplete import, explicit timestamps, stable media identity during blob playback, and lost-response retries with the same source IDs.
- The fixture preview browser check passes: one-time photo confirmation, saved photo reuse, optional replacement, video playback, shortcuts, and mobile layout.
- Backend tests also cover idempotency, uncertain provider submissions, known-task recovery, interrupted delivery, inaccessible references, pair-scoped identity storage, serialized/deduplicated history, and media-only proxy isolation.

## Observed in the real Instagram account

- The participant confirmed their photo through the UI. Three real Seedance outputs reused that photo and auto-sent as native Instagram attachments to the Anthony Lin conversation.
- Text job `dfe03f42-130b-48f0-a5cd-87a622b2ca43` used imported relationship memory (the Bellevue/Miami exchange). Its attachment persisted after reload and played with advancing playback time.
- Continuation job `6a6780f8-ff2c-4951-9416-6ff22c13fbec` used the first output as its explicit video reference and preserved its parent/story relationship. Its attachment persisted and played after reload. Refresh during generation resumed the same task.
- Reel job `b215e84a-eddc-47ae-945d-93bdd4a0faed` used the exact selected source `https://www.instagram.com/reels/DbkE5eixFju/`. Exact media ID `3955307914729904366` resolved to a 14.675-second 720×1280 MP4, publicly readable without Instagram credentials.
- The actual Reel Share dialog displayed **Make this us · Anthony**. Clicking it returned to the designated DM and reused the already-running matching job, without another render. That output auto-sent and its native attachment persisted after reload. Playback after reload is verified: 5.056 seconds, 480×854, readyState 4, currentTime advancing to 4.366 seconds while playing.
- Live generating status appeared as a vertical Reel-shaped message in the conversation; it disappeared after sending. The native composer and existing messages remained in place.
- Three successful renders used 42 Seeddance credits. Last checked balance: 30 available, zero reserved. No further paid generation was used for the minimal-edit prompt, mock endpoint, or UI tests.
- The bounded history import reached 56 messages; after installing the observer fix, live sync added the newest attachment for a total of 57 while retaining the incomplete older-history status. The final read-only audit found 57 unique source IDs, no duplicates, and exactly the two expected authors. The bounded timeout is permitted by Agent.md; retry remains in Settings. New-message observation now continues even while older history is incomplete. Only explicit message datetime attributes are captured; unavailable native timestamps/IDs are not invented.

## Test endpoint

`npm run dev:mock` serves `http://127.0.0.1:5175`; `GET /__mock` exposes captured test requests and state. It never loads credentials or calls Codex/Honcho/Seeddance. Its in-memory jobs return the labeled prerecorded fixture. It is separate from the installed extension's live backend. Mock browser delivery proves the extension contract, not real Instagram receipt; real delivery evidence is listed above.

Recipient-side playback and generation using a second account remain explicitly deferred under Agent.md.

## Completion audit against Agent.md and subsequent instructions

| Requirement | Evidence |
| --- | --- |
| Native Instagram UI and minimal setup | Installed content script retains the composer; mock browser and preview checks cover shortcuts, one-time confirmation, saved photo reuse, optional replacement, and the in-thread Reel placeholder. Later user instructions replace the original preview/Send modal with automatic sending. |
| Pair memory and bounded history import | Real text generation used pair memory; latest remote audit found 57 imported IDs, all unique, from exactly the two participants. Bounded incomplete imports are supported by the specification. Observer regression checks verify ongoing sync, timestamp preservation where exposed, and stable retry IDs. |
| Text, selected Reel, own-video continuation | Three durable real jobs are sent, have local MP4 files and Instagram delivery IDs; the continuation shares its parent's story, while the Reel starts a new one. All three native outputs persisted and played after reload. |
| Exact reference and distinct likenesses | Resolver tests require exact media ID matching; backend and adapter tests preserve source `video_urls` and the confirmed sender photo. No friend photo is substituted. Latest minimal-edit steering is locally tested without another paid render. |
| No stale reference, duplicate render, or redirected send | Native browser test covers fresh requests after prior selections, Share → DM, and refresh recovery. Delivery checks the captured destination before upload and Send. Backend tests cover idempotency and uncertain submissions. |
| Recovery and honest fallback | Backend tests exercise generation failure/timeouts, known-task retry, interrupted delivery, and labeled fixture fallback. Native UI offers Retry and explicitly says “Use prerecorded demo.” |
| Runtime, credentials, and durable state | Native Codex CLI and Seedance 2.5 produced the real outputs; keys stay server-side, public proxy exposes only media, jobs/photos survive reload, and all build/check/test commands pass. |
| Handoff artifacts | README, `.env.example`, `docs/demo.md`, `docs/design.md`, and the standalone mock HTTP endpoint are present. `npm run test:e2e` runs native-flow and history-sync browser checks without paid APIs. |

The installed extension also avoids repeating older-history scrolling for each generation once some history is available. New instructions and scene summaries are recorded together as imagined context. Broader compatibility, large-scale history ingestion, and the second-account recipient check remain the explicit deferred scope.


## Recipient selection and relational persistence update

- The extension detects the current logged-in account and current one-to-one chat. The share action reads the selected recipient instead of a saved demo contact. A mock run selected a second recipient, preserved the share message as steering, recovered the same job after refresh, and showed no previous-account jobs after switching accounts.
- **Make this us** is generic and shares the native footer row with Send. It is enabled for one selected person. Group/bulk selection is outside this one-to-one demo.
- The running backend now uses nine relational tables in Supabase's `public` schema. The old `us_app.records` table was removed after verification. Existing data: 2 accounts, 1 chat, 2 participant rows, 1 confirmed photo, 1 import record, 57 imported-message IDs, 1 memory session, 3 stories, 4 jobs.
- Actual Postgres checks verify foreign keys, participant ownership, idempotency uniqueness, message deduplication, and RLS; all test inserts are rolled back. The migrated backend returns the saved photo and all four sent jobs. No runtime local-file storage fallback or generic-record compatibility path remains.
- Public distribution is not deployed. Other testers currently need the extension and a configured backend. Hosting, backend user authentication, and hosted media storage remain necessary for a consumer release; account/chat namespacing alone is not authentication.
- No new paid video generation was used for these changes.

### 500-message history and v1 Reel placeholders

History collection now targets 500 messages with no elapsed-time cutoff. It stops on the target, an observed beginning, or a stalled loader; a stalled loader remains incomplete and can be retried. Text requests top up older small imports. Before Honcho ingestion, Reel/video attachments become `[reel]`, ordinary chat text retains emoji/slang, and temporary CDN URLs and tracking parameters are removed. No historical video download, transcription, or visual analysis runs.

Mock browser coverage collects 500 chronological messages from virtualized 17-message windows after more than 22 seconds of simulated loading, checks stable retry IDs, and distinguishes short complete chats from stalled loading. The backend test imports 500 messages, checks placeholders/cleaning, and verifies retry deduplication. This does not assert that 500 messages have already been imported from the live Instagram account; existing remote Honcho messages are unchanged.

### New-account onboarding and per-chat indexing status

The live Trần Nam Trân chat was checked read-only: it had a separate pair-scoped Honcho session and 14 imported messages, marked incomplete. The logged-in account's confirmed photo was reused as intended. Chat entry now configures the current pair, prompts accounts without a confirmed photo, and shows saved-photo/indexing status with Settings access. Settings names the account and recipient and offers Index chat/Import more. The mock API now scopes confirmed photos by account and history by conversation; browser coverage verifies a second account sees its own photo prompt and cannot create a job before confirmation. No paid generation was used.

### Profile photo choices and video-free indexing

The newest behavior supersedes the earlier `[reel]` placeholder: Reel/video entries are excluded entirely from new history ingestion and from the 500-message target. Existing Honcho sessions are not silently reset; Reset memory followed by Index chat rebuilds them. The virtualized browser fixture also covers 1,200 alternating Reel/text entries and collects the latest 500 text entries in order.

Photo suggestions use each selected participant’s profile and visible post images, require manual confirmation, and include an upload fallback. The demo friend photo is persisted in the new `chat_reference_photos` table, scoped to the chat and attributed to its owner. Database FK/RLS tests roll back all test data. Mock UI coverage confirms an unrelated account's own photo and a separate recipient photo, then submits the resumed request. Backend tests verify ordered, distinct sender/friend image references. Preview fixtures no longer contain the developer’s account or Anthony; the manual fixture-upload script requires an explicit conversation ID. No paid generation was used for these checks.

Live photo check used the logged-in account and the existing chat selected by an inbox lookup for `anthonylin213`. Anthony’s profile candidate downloaded and decoded at 1080px; no identity was inferred and no photo was saved during the check. The picker now preselects readable profile photos at >=300px for one-tap confirmation and uses local blob thumbnails to avoid Instagram page image restrictions. Empty/unavailable suggestions and undersized photos prompt for upload. These cases are also covered by the mock browser flow.

### Complete Supabase migration, including media

All five existing photo/video assets (10,820,724 bytes) were copied into `public.media_assets` and checked byte-for-byte plus SHA-256. HTTP HEAD, full-file equality, and range responses passed through the running backend. Photo metadata now has foreign keys to media assets. Backend upload, reference-video, generated-output, fallback, and read paths use Postgres; there is no local storage fallback. The former project `data/` folder was moved to a private archive outside the repository only after verification. Photo and video requests still passed after that move, and the project data directory remained absent. No paid provider call was used.

Current checks: 48 unit/backend tests pass, database constraint/RLS checks pass with test rows rolled back, web typecheck and production build pass. Binary assets are queried separately from app-state metadata.

### Cleaner settings and persistent photo reuse

Settings now shows two compact photo cards and collapsed chat-memory controls. Saved media is fetched through the extension bridge and displayed as blob URLs; failed images fall back to initials rather than broken-image text. Saved-photo bytes are cached by immutable media URL. Switching between people and reopening settings do not fetch Instagram suggestions for confirmed photos; only Change photo or a missing saved photo does. Invalid/undersized profile suggestions are removed before rendering, with upload shown as the normal fallback. Mock browser checks verify photo reuse across person switches and a full reload, and confirm both cached saved previews load.

### Initial history window: 500 messages / three months

New history ingestion is limited to the latest 500 eligible messages within the past three calendar months. Native English Instagram date separators supply dates when per-message datetime attributes are absent. Undated/unparseable messages are excluded rather than assumed recent. The collector completes at the age cutoff or message cap; completed short imports are reused after reload. Reels/videos remain excluded. The backend also applies the date filter and per-import cap before Honcho. Existing remote memories are not deleted; ongoing new-message sync can grow the lifetime imported count beyond the initial 500.

Offline tests cover calendar month-end/leap-year cutoffs, relative/native date labels, an age-bounded import below 500, the exact cutoff, unknown dates, and backend rejection of old/undated messages. No paid video request is used for these checks.

## Standalone iOS Instagram wrapper (2026-09-20)

The native app opens `https://www.instagram.com/direct/inbox/` in a persistent WKWebView and injects the existing `apps/extension/entrypoints/instagram.content.ts` bundle into WebKit’s isolated content world. It detects the actual logged-in account and active chat. The separate mobile chat client and fixed conversation preset have been removed.

- Both simulator and unsigned physical-device builds compile with Xcode 27.0. Logs: `artifacts/ios-instagram-build.log` and `artifacts/ios-instagram-device-build.log`.
- The simulator was installed/launched and visibly loaded the real Instagram website. Screenshot: `artifacts/ios-instagram.png`. It has a separate login session and has not been signed into Instagram.
- `US_IOS=1 node scripts/test-native-flow.mjs` exercises the actual bundled iOS script in WebKit with native-message responses backed by an isolated mock server. It retains Instagram’s composer and tests text/Reel/continuation, automatic attachment/send, exact video bytes, chat/account switching, photo confirmation/reuse, and recovery after reload. No real message or paid generation is sent by this test.
- Native backend requests are restricted to existing Us endpoints; native photo downloads are restricted to Instagram image CDNs. Bridge access is restricted to the main Instagram frame in an isolated content world. Extension storage uses JSON in UserDefaults and does not expose provider credentials.

The app was signed with the configured Personal Team and installed on the connected iPhone 17 Pro running iOS 26.6.1. Developer Mode is enabled. Signature verification passed and the provisioning profile includes this device. The user trusted the developer profile and the app launched successfully on the physical phone. Screenshot: `artifacts/ios-physical-instagram.png`. Install/signing logs: `artifacts/ios-phone-install.log` and `artifacts/ios-phone-signing.log`. Signed-in Instagram layout/selectors, actual photo picking, and real Instagram attachment/delivery on the phone remain unverified. Passing browser fixtures and a native launch do not establish that live phone flows pass.

The Reel share-sheet action now persists the complete request with a stable idempotency key before navigating, then starts generation automatically in the destination DM. No second composer submission is needed. Edited video controls include a compact Original link resolving to the source Reel permalink through continuation parents. Chrome and iOS/WebKit fixture checks cover this one-tap flow, Original links, and reload without duplicate generation/delivery.
