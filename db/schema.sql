-- Minimal starter schema for Markaestro

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  created_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key,
  workspace_id uuid references workspaces(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'owner',
  created_at timestamptz not null default now()
);

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  channel text not null,
  status text not null default 'draft',
  target_audience text,
  cta text,
  scheduled_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists automations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  enabled boolean not null default false,
  trigger_type text not null,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
