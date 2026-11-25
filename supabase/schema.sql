-- La Chavitera : synchro du foyer. À coller dans Supabase > SQL Editor > Run.
create table if not exists public.household_state (
  code text primary key check (char_length(code) >= 19),
  entries jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.household_state enable row level security;
-- aucune policy : la table n'est accessible QUE via les fonctions ci-dessous (il faut connaître le code)
revoke all on public.household_state from anon, authenticated;

-- fusion clé par clé : pour chaque clé, la version la plus récente (champ t) gagne
create or replace function public.merge_state(p_code text, p_entries jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cur jsonb; k text; v jsonb;
begin
  if char_length(p_code) < 19 then raise exception 'code invalide'; end if;
  insert into household_state(code) values (p_code) on conflict (code) do nothing;
  select entries into cur from household_state where code = p_code for update;
  for k, v in select * from jsonb_each(coalesce(p_entries, '{}'::jsonb)) loop
    if cur -> k is null or coalesce((cur -> k ->> 't')::bigint, 0) < coalesce((v ->> 't')::bigint, 0) then
      cur := jsonb_set(cur, array[k], v, true);
    end if;
  end loop;
  update household_state set entries = cur, updated_at = now() where code = p_code;
  return cur;
end $$;

revoke all on function public.merge_state(text, jsonb) from public;
grant execute on function public.merge_state(text, jsonb) to anon, authenticated;
