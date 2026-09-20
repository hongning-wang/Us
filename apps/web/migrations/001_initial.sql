CREATE TABLE IF NOT EXISTS public.accounts (
 id text PRIMARY KEY,
 username text NOT NULL UNIQUE,
 display_name text NOT NULL
);
CREATE TABLE IF NOT EXISTS public.chats (
 id text PRIMARY KEY,
 instagram_thread_id text NOT NULL,
 owner_id text NOT NULL REFERENCES public.accounts(id),
 UNIQUE (owner_id, instagram_thread_id),
 UNIQUE (id, owner_id)
);
CREATE TABLE IF NOT EXISTS public.chat_participants (
 chat_id text NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
 account_id text NOT NULL REFERENCES public.accounts(id),
 PRIMARY KEY (chat_id, account_id)
);
CREATE TABLE IF NOT EXISTS public.identity_photos (
 account_id text PRIMARY KEY REFERENCES public.accounts(id),
 filename text NOT NULL,
 content_type text NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
 confirmed_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS public.history_imports (
 chat_id text PRIMARY KEY REFERENCES public.chats(id) ON DELETE CASCADE,
 complete boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.imported_messages (
 chat_id text NOT NULL REFERENCES public.history_imports(chat_id) ON DELETE CASCADE,
 source_message_id text NOT NULL,
 pending boolean NOT NULL DEFAULT false,
 PRIMARY KEY (chat_id, source_message_id)
);
CREATE TABLE IF NOT EXISTS public.memory_sessions (
 chat_id text PRIMARY KEY REFERENCES public.chats(id) ON DELETE CASCADE,
 honcho_session_id text NOT NULL UNIQUE,
 generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
 status text NOT NULL,
 last_error text
);
CREATE TABLE IF NOT EXISTS public.stories (
 id uuid PRIMARY KEY,
 chat_id text NOT NULL REFERENCES public.chats(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,chat_id)
);
CREATE TABLE IF NOT EXISTS public.jobs (
 id uuid PRIMARY KEY,
 chat_id text NOT NULL,
 sender_id text NOT NULL,
 recipient_id text NOT NULL,
 instruction text NOT NULL,
 story_id uuid NOT NULL,
 parent_job_id uuid,
 idempotency_key text,
 status text NOT NULL CHECK (status IN ('generating','ready','sending','sent','failed')),
 phase text,
 scene_summary text,
 reference_kind text CHECK (reference_kind IN ('reel','video')),
 reference_media_id text,
 reference_url text,
 reference_message_id text,
 reference_parent_job_id uuid,
 output_url text,
 fallback_url text,
 is_fallback boolean NOT NULL DEFAULT false,
 error text,
 delivery_message_id text,
 created_at timestamptz NOT NULL,
 stage text NOT NULL CHECK (stage IN ('spec','generate','deliver','done')),
 attempts integer NOT NULL CHECK (attempts >= 0),
 generation_spec jsonb,
 provider text,
 provider_task_id text UNIQUE,
 provider_status text,
 submission_uncertain boolean NOT NULL DEFAULT false,
 delivery_uncertain boolean NOT NULL DEFAULT false,
 warnings text[] NOT NULL DEFAULT '{}',
 deadline_ms bigint,
 abandoned boolean NOT NULL DEFAULT false,
 memory_used boolean NOT NULL DEFAULT false,
 CHECK(sender_id <> recipient_id),
 CHECK ((reference_kind IS NULL) = (reference_media_id IS NULL)),
 FOREIGN KEY(chat_id,sender_id) REFERENCES public.chats(id,owner_id),
 FOREIGN KEY(chat_id,recipient_id) REFERENCES public.chat_participants(chat_id,account_id),
 FOREIGN KEY(story_id,chat_id) REFERENCES public.stories(id,chat_id),
 UNIQUE(id,chat_id,story_id),
 FOREIGN KEY(parent_job_id,chat_id,story_id) REFERENCES public.jobs(id,chat_id,story_id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(reference_parent_job_id) REFERENCES public.jobs(id) DEFERRABLE INITIALLY DEFERRED,
 UNIQUE(chat_id,idempotency_key),
 UNIQUE(chat_id,delivery_message_id)
);
CREATE INDEX IF NOT EXISTS jobs_chat_created_idx ON public.jobs(chat_id,created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_active_idx ON public.jobs(status) WHERE status IN ('generating','ready','sending');
CREATE INDEX IF NOT EXISTS participants_account_idx ON public.chat_participants(account_id);
CREATE INDEX IF NOT EXISTS imported_messages_pending_idx ON public.imported_messages(chat_id) WHERE pending;
-- Backend connects directly. No browser-facing database access is granted.
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identity_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.history_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imported_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
