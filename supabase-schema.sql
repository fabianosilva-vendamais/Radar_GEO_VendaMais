-- Radar AEO/GEO VendaMais — base de dados
-- Como usar: Supabase → SQL Editor → New query → cole tudo → Run.

create table if not exists app_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

alter table app_state enable row level security;

-- Acesso aberto (sem login), conforme configurado para 2 usuários:
create policy "leitura aberta"  on app_state for select using (true);
create policy "insercao aberta" on app_state for insert with check (true);
create policy "edicao aberta"   on app_state for update using (true) with check (true);
