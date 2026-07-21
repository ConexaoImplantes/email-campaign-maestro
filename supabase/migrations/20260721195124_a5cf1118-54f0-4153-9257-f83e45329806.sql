
ALTER TABLE public.profiles ALTER COLUMN smtp_pass_encrypted TYPE TEXT USING NULL;
DROP FUNCTION IF EXISTS public.set_smtp_password(TEXT);
DROP FUNCTION IF EXISTS public.encrypt_smtp_pass(TEXT);
DROP FUNCTION IF EXISTS public.decrypt_smtp_pass(BYTEA);
