-- Add first-pass revenue model fields to client billing profiles.
-- Run after billing_profiles exists.

alter table if exists public.billing_profiles
  add column if not exists hourly_rate numeric;

alter table if exists public.billing_profiles
  add column if not exists breaks_billable boolean not null default true;

alter table if exists public.billing_profiles
  add column if not exists total_billable_hours numeric;

alter table if exists public.billing_profiles
  add column if not exists other_monthly_charges numeric;

alter table if exists public.billing_profiles
  add column if not exists revenue_charge_items jsonb not null default '[]'::jsonb;

alter table if exists public.billing_profiles
  add column if not exists monthly_cost_items jsonb not null default '[]'::jsonb;

alter table if exists public.billing_profiles
  drop constraint if exists billing_profiles_hourly_rate_non_negative;

alter table if exists public.billing_profiles
  add constraint billing_profiles_hourly_rate_non_negative
  check (hourly_rate is null or hourly_rate >= 0);

alter table if exists public.billing_profiles
  drop constraint if exists billing_profiles_total_billable_hours_non_negative;

alter table if exists public.billing_profiles
  add constraint billing_profiles_total_billable_hours_non_negative
  check (total_billable_hours is null or total_billable_hours >= 0);

alter table if exists public.billing_profiles
  drop constraint if exists billing_profiles_other_monthly_charges_non_negative;

alter table if exists public.billing_profiles
  add constraint billing_profiles_other_monthly_charges_non_negative
  check (other_monthly_charges is null or other_monthly_charges >= 0);

alter table if exists public.billing_profiles
  drop constraint if exists billing_profiles_revenue_charge_items_is_array;

alter table if exists public.billing_profiles
  add constraint billing_profiles_revenue_charge_items_is_array
  check (jsonb_typeof(revenue_charge_items) = 'array');

alter table if exists public.billing_profiles
  drop constraint if exists billing_profiles_monthly_cost_items_is_array;

alter table if exists public.billing_profiles
  add constraint billing_profiles_monthly_cost_items_is_array
  check (jsonb_typeof(monthly_cost_items) = 'array');
