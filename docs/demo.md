# Single-account demo

Use any existing one-to-one DM in the installed Chrome profile. Sending delivers a real message to the selected person. Anthony Lin was the original verification conversation. Keep the local app, media proxy, and tunnel running.

1. Enter `/us settings`. Choose and confirm your own photo once. Close settings and type `/us` with an idea; it should reuse the saved photo. History imports automatically when needed. Settings shows the count and an optional retry for incomplete history.
2. Type `/us Imagine us celebrating after a long day` into Instagram's composer and press Enter. The raw command must disappear without becoming a DM. Watch the job progress; reload once while generating to verify the same job resumes. The generated scene should reflect a relevant fact from the imported pair memory, with imagined events kept distinct.
3. Wait for automatic delivery through Instagram’s native attachment control. Confirm a native video message appears. Reload Instagram, open that attachment, and play it again. Record its job and delivery IDs from local state. Do not count an injected preview card as delivery.
4. Reply to that exact sent video using Instagram's Reply action, type `/us What happens next?`, and generate. This job must point to the first job as its parent and keep its story ID. The continuation auto-sends; verify playback after reload.
5. Select a shared Reel and choose **Make this us**, or use the Us action in its share sheet for the currently selected person. The shortcut fills the native reply composer; edit the steering if desired, then submit `/us`. The result auto-sends. Verify that the selected Reel is the scene reference.
6. Start a fresh `/us` idea without replying to a video. Its request must contain no prior Reel/video reference and use a new story ID. Avoid buying a fourth generation just to check this: inspect the request in a local mocked run.
7. Exercise generation timeout/failure and delivery interruption with fixtures/mocks first. Retry must reuse a known provider task and reconcile uncertain uploads. A fallback must display **Prerecorded demo · not AI generated**.
8. Reimport history and compare the imported count and remote message IDs. The same messages must not be duplicated. Use **Reset memory** only when intentionally beginning a fresh memory session.

For routine iteration, run `npm run test:e2e` against the isolated HTTP mock. Use `npm run dev:mock` for manual API requests; inspect `/__mock` to confirm the selected video URL. Do not repeat paid renders for UI or prompt changes.

Budget: validate media access, photo confirmation, imported memory, and provider inputs before any live POST. Run one five-second 480p generation at a time. A lost create response is not permission to submit again; inspect the provider account/task first.

Deferred: sign in as the recipient in a second account/profile, receive and play a generated video, confirm that person's photo, install the extension there, and generate a reply. Until then, recipient-side behavior remains unverified.
