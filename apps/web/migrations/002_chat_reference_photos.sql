-- A demo photo chosen by the chat owner is separate from someone's self-confirmed identity.
CREATE TABLE IF NOT EXISTS public.chat_reference_photos (
 chat_id text PRIMARY KEY REFERENCES public.chats(id) ON DELETE CASCADE,
 participant_id text NOT NULL,
 confirmed_by text NOT NULL,
 filename text NOT NULL,
 content_type text NOT NULL CHECK(content_type IN ('image/jpeg','image/png','image/webp')),
 confirmed_at timestamptz NOT NULL,
 CHECK(participant_id <> confirmed_by),
 FOREIGN KEY(chat_id,participant_id) REFERENCES public.chat_participants(chat_id,account_id),
 FOREIGN KEY(chat_id,confirmed_by) REFERENCES public.chats(id,owner_id)
);
ALTER TABLE public.chat_reference_photos ENABLE ROW LEVEL SECURITY;
