create or replace function public.enable_rls_on_table_create()
returns event_trigger
language plpgsql
as $function$
declare
  cmd record;
begin
  for cmd in
    select schema_name, object_identity
      from pg_event_trigger_ddl_commands()
     where command_tag = 'CREATE TABLE'
       and not in_extension
  loop
    if cmd.schema_name = 'public' then
      execute format('alter table %s enable row level security', cmd.object_identity);
    end if;
  end loop;
end;
$function$;

drop event trigger if exists enable_rls_on_create_table;
create event trigger enable_rls_on_create_table
  on ddl_command_end
  when tag in ('CREATE TABLE')
  execute function public.enable_rls_on_table_create();