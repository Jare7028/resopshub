-- Ensure chat attachments bucket is private.
-- Run once in Supabase SQL editor for existing environments.

update storage.buckets
set public = false
where id = 'chat-attachments';
