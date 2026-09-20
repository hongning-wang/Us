-- Small v1 demo assets live in Postgres, so the demo has no local data dependency.
CREATE TABLE IF NOT EXISTS public.media_assets (
 filename text PRIMARY KEY CHECK(filename ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$' AND position('..' in filename)=0),
 content_type text NOT NULL,
 byte_length integer NOT NULL CHECK(byte_length > 0 AND byte_length <= 52428800),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 content bytea NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(byte_length=octet_length(content))
);
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;
