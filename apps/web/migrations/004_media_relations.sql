DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='identity_photos_media_fk' AND conrelid='public.identity_photos'::regclass) THEN
  ALTER TABLE public.identity_photos ADD CONSTRAINT identity_photos_media_fk FOREIGN KEY(filename) REFERENCES public.media_assets(filename);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chat_reference_photos_media_fk' AND conrelid='public.chat_reference_photos'::regclass) THEN
  ALTER TABLE public.chat_reference_photos ADD CONSTRAINT chat_reference_photos_media_fk FOREIGN KEY(filename) REFERENCES public.media_assets(filename);
 END IF;
END $$;
