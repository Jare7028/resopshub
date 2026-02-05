create extension if not exists "pgcrypto";

create table if not exists personal_sections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists personal_pages (
  id uuid primary key default gen_random_uuid(),
  section_id uuid references personal_sections(id) on delete set null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  share_mode text not null default 'private' check (share_mode in ('private', 'inherit', 'custom')),
  content jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table personal_pages
add column if not exists content jsonb;

update personal_pages
set content = '{"type":"doc","content":[{"type":"paragraph"}]}'
where content is null;

create table if not exists personal_section_members (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references personal_sections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'view' check (role in ('view', 'edit')),
  created_at timestamptz not null default now(),
  unique (section_id, user_id)
);

create table if not exists personal_page_members (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references personal_pages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'view' check (role in ('view', 'edit')),
  created_at timestamptz not null default now(),
  unique (page_id, user_id)
);

create table if not exists personal_blocks (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references personal_pages(id) on delete cascade,
  type text not null,
  content jsonb not null default '{}'::jsonb,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table personal_sections enable row level security;
alter table personal_pages enable row level security;
alter table personal_section_members enable row level security;
alter table personal_page_members enable row level security;
alter table personal_blocks enable row level security;

create policy personal_sections_select
on personal_sections
for select
using (
  owner_id = auth.uid()
  or exists (
    select 1
    from personal_section_members m
    where m.section_id = id and m.user_id = auth.uid()
  )
);

create policy personal_sections_insert
on personal_sections
for insert
with check (owner_id = auth.uid());

create policy personal_sections_update
on personal_sections
for update
using (
  owner_id = auth.uid()
  or exists (
    select 1
    from personal_section_members m
    where m.section_id = id and m.user_id = auth.uid() and m.role = 'edit'
  )
)
with check (
  owner_id = auth.uid()
  or exists (
    select 1
    from personal_section_members m
    where m.section_id = id and m.user_id = auth.uid() and m.role = 'edit'
  )
);

create policy personal_sections_delete
on personal_sections
for delete
using (owner_id = auth.uid());

create policy personal_section_members_select
on personal_section_members
for select
using (
  exists (
    select 1
    from personal_sections s
    where s.id = section_id and (
      s.owner_id = auth.uid()
      or exists (
        select 1
        from personal_section_members m
        where m.section_id = s.id and m.user_id = auth.uid()
      )
    )
  )
);

create policy personal_section_members_insert
on personal_section_members
for insert
with check (
  exists (
    select 1
    from personal_sections s
    where s.id = section_id and (
      s.owner_id = auth.uid()
      or exists (
        select 1
        from personal_section_members m
        where m.section_id = s.id and m.user_id = auth.uid() and m.role = 'edit'
      )
    )
  )
);

create policy personal_section_members_update
on personal_section_members
for update
using (
  exists (
    select 1
    from personal_sections s
    where s.id = section_id and (
      s.owner_id = auth.uid()
      or exists (
        select 1
        from personal_section_members m
        where m.section_id = s.id and m.user_id = auth.uid() and m.role = 'edit'
      )
    )
  )
)
with check (
  exists (
    select 1
    from personal_sections s
    where s.id = section_id and (
      s.owner_id = auth.uid()
      or exists (
        select 1
        from personal_section_members m
        where m.section_id = s.id and m.user_id = auth.uid() and m.role = 'edit'
      )
    )
  )
);

create policy personal_section_members_delete
on personal_section_members
for delete
using (
  exists (
    select 1
    from personal_sections s
    where s.id = section_id and (
      s.owner_id = auth.uid()
      or exists (
        select 1
        from personal_section_members m
        where m.section_id = s.id and m.user_id = auth.uid() and m.role = 'edit'
      )
    )
  )
);

create policy personal_pages_select
on personal_pages
for select
using (
  owner_id = auth.uid()
  or (
    share_mode = 'inherit'
    and (
      exists (
        select 1
        from personal_section_members m
        where m.section_id = section_id and m.user_id = auth.uid()
      )
      or exists (
        select 1
        from personal_page_members pm
        where pm.page_id = id and pm.user_id = auth.uid()
      )
    )
  )
  or (
    share_mode = 'custom'
    and exists (
      select 1
      from personal_page_members pm
      where pm.page_id = id and pm.user_id = auth.uid()
    )
  )
);

create policy personal_pages_insert
on personal_pages
for insert
with check (owner_id = auth.uid());

create policy personal_pages_update
on personal_pages
for update
using (
  owner_id = auth.uid()
  or (
    share_mode = 'inherit'
    and (
      exists (
        select 1
        from personal_section_members m
        where m.section_id = section_id and m.user_id = auth.uid() and m.role = 'edit'
      )
      or exists (
        select 1
        from personal_page_members pm
        where pm.page_id = id and pm.user_id = auth.uid() and pm.role = 'edit'
      )
    )
  )
  or (
    share_mode = 'custom'
    and exists (
      select 1
      from personal_page_members pm
      where pm.page_id = id and pm.user_id = auth.uid() and pm.role = 'edit'
    )
  )
)
with check (
  owner_id = auth.uid()
  or (
    share_mode = 'inherit'
    and (
      exists (
        select 1
        from personal_section_members m
        where m.section_id = section_id and m.user_id = auth.uid() and m.role = 'edit'
      )
      or exists (
        select 1
        from personal_page_members pm
        where pm.page_id = id and pm.user_id = auth.uid() and pm.role = 'edit'
      )
    )
  )
  or (
    share_mode = 'custom'
    and exists (
      select 1
      from personal_page_members pm
      where pm.page_id = id and pm.user_id = auth.uid() and pm.role = 'edit'
    )
  )
);

create policy personal_pages_delete
on personal_pages
for delete
using (owner_id = auth.uid());

create policy personal_page_members_select
on personal_page_members
for select
using (
  exists (
    select 1
    from personal_pages p
    where p.id = page_id and (
      p.owner_id = auth.uid()
      or exists (
        select 1
        from personal_page_members pm
        where pm.page_id = p.id and pm.user_id = auth.uid()
      )
      or (
        p.share_mode = 'inherit'
        and exists (
          select 1
          from personal_section_members sm
          where sm.section_id = p.section_id and sm.user_id = auth.uid()
        )
      )
    )
  )
);

create policy personal_page_members_insert
on personal_page_members
for insert
with check (
  exists (
    select 1
    from personal_pages p
    where p.id = page_id and (
      p.owner_id = auth.uid()
      or exists (
        select 1
        from personal_section_members sm
        where sm.section_id = p.section_id and sm.user_id = auth.uid() and sm.role = 'edit'
      )
      or exists (
        select 1
        from personal_page_members pm
        where pm.page_id = p.id and pm.user_id = auth.uid() and pm.role = 'edit'
      )
    )
  )
);

create policy personal_page_members_update
on personal_page_members
for update
using (
  exists (
    select 1
    from personal_pages p
    where p.id = page_id and (
      p.owner_id = auth.uid()
      or exists (
        select 1
        from personal_section_members sm
        where sm.section_id = p.section_id and sm.user_id = auth.uid() and sm.role = 'edit'
      )
      or exists (
        select 1
        from personal_page_members pm
        where pm.page_id = p.id and pm.user_id = auth.uid() and pm.role = 'edit'
      )
    )
  )
)
with check (
  exists (
    select 1
    from personal_pages p
    where p.id = page_id and (
      p.owner_id = auth.uid()
      or exists (
        select 1
        from personal_section_members sm
        where sm.section_id = p.section_id and sm.user_id = auth.uid() and sm.role = 'edit'
      )
      or exists (
        select 1
        from personal_page_members pm
        where pm.page_id = p.id and pm.user_id = auth.uid() and pm.role = 'edit'
      )
    )
  )
);

create policy personal_page_members_delete
on personal_page_members
for delete
using (
  exists (
    select 1
    from personal_pages p
    where p.id = page_id and (
      p.owner_id = auth.uid()
      or exists (
        select 1
        from personal_section_members sm
        where sm.section_id = p.section_id and sm.user_id = auth.uid() and sm.role = 'edit'
      )
      or exists (
        select 1
        from personal_page_members pm
        where pm.page_id = p.id and pm.user_id = auth.uid() and pm.role = 'edit'
      )
    )
  )
);

create policy personal_blocks_select
on personal_blocks
for select
using (
  exists (
    select 1
    from personal_pages p
    where p.id = page_id and (
      p.owner_id = auth.uid()
      or (
        p.share_mode = 'inherit'
        and (
          exists (
            select 1
            from personal_section_members sm
            where sm.section_id = p.section_id and sm.user_id = auth.uid()
          )
          or exists (
            select 1
            from personal_page_members pm
            where pm.page_id = p.id and pm.user_id = auth.uid()
          )
        )
      )
      or (
        p.share_mode = 'custom'
        and exists (
          select 1
          from personal_page_members pm
          where pm.page_id = p.id and pm.user_id = auth.uid()
        )
      )
    )
  )
);

create policy personal_blocks_insert
on personal_blocks
for insert
with check (
  exists (
    select 1
    from personal_pages p
    where p.id = page_id and (
      p.owner_id = auth.uid()
      or (
        p.share_mode = 'inherit'
        and (
          exists (
            select 1
            from personal_section_members sm
            where sm.section_id = p.section_id and sm.user_id = auth.uid() and sm.role = 'edit'
          )
          or exists (
            select 1
            from personal_page_members pm
            where pm.page_id = p.id and pm.user_id = auth.uid() and pm.role = 'edit'
          )
        )
      )
      or (
        p.share_mode = 'custom'
        and exists (
          select 1
          from personal_page_members pm
          where pm.page_id = p.id and pm.user_id = auth.uid() and pm.role = 'edit'
        )
      )
    )
  )
);

create policy personal_blocks_update
on personal_blocks
for update
using (
  exists (
    select 1
    from personal_pages p
    where p.id = page_id and (
      p.owner_id = auth.uid()
      or (
        p.share_mode = 'inherit'
        and (
          exists (
            select 1
            from personal_section_members sm
            where sm.section_id = p.section_id and sm.user_id = auth.uid() and sm.role = 'edit'
          )
          or exists (
            select 1
            from personal_page_members pm
            where pm.page_id = p.id and pm.user_id = auth.uid() and pm.role = 'edit'
          )
        )
      )
      or (
        p.share_mode = 'custom'
        and exists (
          select 1
          from personal_page_members pm
          where pm.page_id = p.id and pm.user_id = auth.uid() and pm.role = 'edit'
        )
      )
    )
  )
)
with check (
  exists (
    select 1
    from personal_pages p
    where p.id = page_id and (
      p.owner_id = auth.uid()
      or (
        p.share_mode = 'inherit'
        and (
          exists (
            select 1
            from personal_section_members sm
            where sm.section_id = p.section_id and sm.user_id = auth.uid() and sm.role = 'edit'
          )
          or exists (
            select 1
            from personal_page_members pm
            where pm.page_id = p.id and pm.user_id = auth.uid() and pm.role = 'edit'
          )
        )
      )
      or (
        p.share_mode = 'custom'
        and exists (
          select 1
          from personal_page_members pm
          where pm.page_id = p.id and pm.user_id = auth.uid() and pm.role = 'edit'
        )
      )
    )
  )
);

create policy personal_blocks_delete
on personal_blocks
for delete
using (
  exists (
    select 1
    from personal_pages p
    where p.id = page_id and (
      p.owner_id = auth.uid()
      or (
        p.share_mode = 'inherit'
        and (
          exists (
            select 1
            from personal_section_members sm
            where sm.section_id = p.section_id and sm.user_id = auth.uid() and sm.role = 'edit'
          )
          or exists (
            select 1
            from personal_page_members pm
            where pm.page_id = p.id and pm.user_id = auth.uid() and pm.role = 'edit'
          )
        )
      )
      or (
        p.share_mode = 'custom'
        and exists (
          select 1
          from personal_page_members pm
          where pm.page_id = p.id and pm.user_id = auth.uid() and pm.role = 'edit'
        )
      )
    )
  )
);

-- RLS recursion fix for membership tables (use security definer helpers)
create or replace function public.is_section_member(section_uuid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from personal_sections s
    where s.id = section_uuid and s.owner_id = auth.uid()
  )
  or exists (
    select 1
    from personal_section_members m
    where m.section_id = section_uuid and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_section_editor(section_uuid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from personal_sections s
    where s.id = section_uuid and s.owner_id = auth.uid()
  )
  or exists (
    select 1
    from personal_section_members m
    where m.section_id = section_uuid and m.user_id = auth.uid() and m.role = 'edit'
  );
$$;

create or replace function public.is_page_member(page_uuid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from personal_pages p
    where p.id = page_uuid and p.owner_id = auth.uid()
  )
  or exists (
    select 1
    from personal_page_members pm
    where pm.page_id = page_uuid and pm.user_id = auth.uid()
  )
  or exists (
    select 1
    from personal_pages p
    join personal_section_members sm on sm.section_id = p.section_id
    where p.id = page_uuid and p.share_mode = 'inherit' and sm.user_id = auth.uid()
  );
$$;

create or replace function public.is_page_editor(page_uuid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from personal_pages p
    where p.id = page_uuid and p.owner_id = auth.uid()
  )
  or exists (
    select 1
    from personal_page_members pm
    where pm.page_id = page_uuid and pm.user_id = auth.uid() and pm.role = 'edit'
  )
  or exists (
    select 1
    from personal_pages p
    join personal_section_members sm on sm.section_id = p.section_id
    where p.id = page_uuid and p.share_mode = 'inherit' and sm.user_id = auth.uid() and sm.role = 'edit'
  );
$$;

drop policy if exists personal_section_members_select on personal_section_members;
drop policy if exists personal_section_members_insert on personal_section_members;
drop policy if exists personal_section_members_update on personal_section_members;
drop policy if exists personal_section_members_delete on personal_section_members;

create policy personal_section_members_select
on personal_section_members
for select
using (is_section_member(section_id) or user_id = auth.uid());

create policy personal_section_members_insert
on personal_section_members
for insert
with check (is_section_editor(section_id));

create policy personal_section_members_update
on personal_section_members
for update
using (is_section_editor(section_id))
with check (is_section_editor(section_id));

create policy personal_section_members_delete
on personal_section_members
for delete
using (is_section_editor(section_id));

drop policy if exists personal_page_members_select on personal_page_members;
drop policy if exists personal_page_members_insert on personal_page_members;
drop policy if exists personal_page_members_update on personal_page_members;
drop policy if exists personal_page_members_delete on personal_page_members;

create policy personal_page_members_select
on personal_page_members
for select
using (is_page_member(page_id) or user_id = auth.uid());

create policy personal_page_members_insert
on personal_page_members
for insert
with check (is_page_editor(page_id));

create policy personal_page_members_update
on personal_page_members
for update
using (is_page_editor(page_id))
with check (is_page_editor(page_id));

create policy personal_page_members_delete
on personal_page_members
for delete
using (is_page_editor(page_id));
