do $$
begin
  if to_regclass('public.public_inquiries') is not null then
    alter table public.public_inquiries enable row level security;
    grant all on public.public_inquiries to authenticated;
    drop policy if exists "authenticated_all" on public.public_inquiries;
    create policy "authenticated_all" on public.public_inquiries for all to authenticated using (true) with check (true);
  end if;
end $$;