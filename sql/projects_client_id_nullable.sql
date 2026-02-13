-- Allow projects without a client.
-- Run in Supabase SQL editor.

alter table public.projects
  alter column client_id drop not null;
