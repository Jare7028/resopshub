-- Add account owner field to clients.
alter table public.clients
  add column if not exists account_owner text;

