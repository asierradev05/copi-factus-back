do $$
declare t text;
begin
  foreach t in array array[
    'profiles',
    'customers',
    'service_types',
    'services',
    'products',
    'invoices',
    'invoice_items',
    'service_invoice_links',
    'payments',
    'audit_logs',
    'company_settings',
    'service_categories',
    'service_subcategories',
    'recurring_services',
    'invoice_uploads',
    'document_sequences',
    'quotes',
    'purchase_orders',
    'delivery_orders',
    'resolutions',
    'received_documents',
    'public_inquiries'
  ]
  loop
    if to_regclass('public.' || quote_ident(t)) is not null then
      execute format('alter table public.%I enable row level security', t);
    end if;
  end loop;
end $$;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

grant usage on all sequences in schema public to authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'customers',
    'service_types',
    'services',
    'products',
    'invoices',
    'invoice_items',
    'service_invoice_links',
    'payments',
    'audit_logs',
    'company_settings',
    'service_categories',
    'service_subcategories',
    'recurring_services',
    'invoice_uploads',
    'document_sequences',
    'quotes',
    'purchase_orders',
    'delivery_orders',
    'resolutions',
    'received_documents',
    'public_inquiries'
  ]
  loop
    if to_regclass('public.' || quote_ident(t)) is not null then
      execute format('grant all on public.%I to authenticated', t);
      execute format('drop policy if exists "authenticated_all" on public.%I', t);
      execute format('create policy "authenticated_all" on public.%I for all to authenticated using (true) with check (true)', t);
    end if;
  end loop;
end $$;

revoke all on public.profiles from authenticated;
grant select (id, auth_id, email, full_name, role, is_active, created_at, updated_at) on public.profiles to authenticated;
grant update (full_name, email) on public.profiles to authenticated;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select to authenticated using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update to authenticated using (auth.uid()::text = auth_id) with check (auth.uid()::text = auth_id);