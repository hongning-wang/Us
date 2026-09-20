# Us — demo specification

Build a Chrome extension that lets two friends create and exchange personalized AI videos inside Instagram DMs. Videos draw on their shared history and confirmed photos; replying to a video lets them imagine what happens next.

## Scope

- WXT extension with Svelte UI; SvelteKit backend; Honcho for persistent relationship memory.
- Develop and test with one logged-in Instagram account, one Chrome profile, and one extension installation. Use an existing two-person DM; the other participant need not be online or install anything. Keep the two participant identities distinct in memory.
- Complete text-to-video first, then Reel personalization and video replies. All three belong to the complete demo.
- Use `possible designer.png` for visual direction, adapted to desktop Instagram. Match native DM/Reel styling; keep the experience inside Instagram.
- Defer group chats, broad compatibility, production hardening, and large-scale history ingestion. Choose simple, extensible implementations for unspecified details.
- Use codex natively as the means of LLM.

## Setup and personalization

- Configure the test account and designated conversation. During setup, the extension scrapes the designated DM in the logged-in Instagram browser session and seeds Honcho with the most recent 100 messages, loading older messages as needed. Stop at the limit, the beginning of the conversation, or a bounded timeout; show the imported count and allow retry if incomplete.
- Preserve message order, authors, text, and available timestamps/message IDs. Deduplicate imports across retries and both participants. Import available media captions/links as context; do not download all historical attachments or treat them as generation references.
- Preload or upload the logged-in participant's reference photo. During first setup, the in-product agent asks, "Is this your photo?" Confirm or replace it before generation and store the association with their Instagram identity. One confirmed photo is sufficient for development; omit the other participant's likeness until they confirm their own photo. Never reuse one person's photo for both identities.
- Keep Honcho memory scoped to this pair. Ingest new messages observed while the designated DM is open, plus generation instructions and scene summaries; distinguish imagined events from real relationship facts.

## User flows

1. **Text:** In the DM composer, submit `/us Imagine us ...`. Intercept the command, use the text after `/us` as steering, and create a generation job. Do not send the raw command as an ordinary DM. Empty `/us` prompts for an instruction.
2. **Reel:** Add "Make this us" to the Reel sharing experience. Select the demo recipient, optionally add steering, and generate using that Reel as the explicit reference. Default steering is to personalize the scene for the pair.
3. **Reply:** Reply to a video or shared Reel with `/us ...` to use that specific video as the reference. Without an explicit video reply or Reel selection, use no scene media reference. Photos and ordinary message replies do not become scene references; confirmed identity photos remain available in every mode.
4. **Delivery:** Show generation progress, then a playable preview with Send. Send uploads the actual video into the designated Instagram DM; this is a real message to the other participant even during single-account testing. Verify that the attachment persists and plays after reload. Test continuation by replying to the test account's own sent video. A local injected card or backend-only sync does not count as delivery.

## Generation and state
- API keys are in .env
- The extension sends the conversation, sender/recipient identities, steering, and optional reference message/media ID to SvelteKit. Capture the destination at submission so changing chats cannot redirect delivery.
- SvelteKit retrieves pair memory and confirmed photos. A fixed LLM prompt produces a validated generation specification: scene prompt, identity references, optional video reference, and output settings.
- Target Seedance 2.5 through a provider adapter. 
- Resolve selected Instagram media into usable assets; use Instaloader if suitable, adding a Python worker only when necessary. Surface unsupported references rather than silently dropping them.
- Persist jobs and media independently of Honcho. Track conversation, participants, instruction, reference, story/parent IDs, scene summary, output, and delivery status. A reply to an Us video continues its story; an unreferenced request starts a new story while retaining relationship memory.
- Use asynchronous jobs with polling. Show generating, ready, sending, sent, and failed states. Refreshes resume existing jobs; retries must avoid duplicate generation or delivery. Keep provider credentials on the backend.
- Provide clear errors and Retry. Offer an explicitly labeled prerecorded fallback when generation fails or exceeds a configurable timeout. Never present fallback playback as successful live generation.

## Completion

Implement and run the full flow in one browser session, and fix failures until these development criteria pass:

- Check using my instagram (opened in Chrome), you can try with my chat with Anthony Lin
- The test participant confirms their photo; history imported from the real Instagram DM seeds memory and influences a real generated video. Reimporting does not duplicate messages.
- Text generation, selected-Reel personalization, and continuation from the test account's own sent video each work.
- Generated videos appear as real Instagram DM attachments and persist and play after reload. Confirm uploading feasibility early with a fixture video.
- An unreferenced request does not reuse previous scene media. Refresh/retry does not duplicate sends; generation and delivery failures are recoverable.
- Supply concise setup/run instructions, an environment-variable template, history import/reset controls, and a repeatable single-account demo script.

Final recipient verification is a separate check: use a second logged-in account to receive and play a generated attachment, confirm its owner's photo, and generate a reply with the extension. Defer this check during single-account development and report recipient-side behavior as unverified until it passes.

The remaining external inputs are provider/model access, LLM and Honcho credentials, demo account access, and participant photos. Request missing inputs when needed and continue independent implementation. Fixtures can unblock development, but report any unverified live integration explicitly; fallback-only operation does not satisfy completion.

Run Devin where needeed through cli to help you out.
