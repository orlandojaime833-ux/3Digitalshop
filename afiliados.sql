-- ════════════════════════════════════════════════════════
-- DIGIMarket — Sistema de Afiliados
-- Cola no SQL Editor do Supabase e clica "Run"
-- ════════════════════════════════════════════════════════

-- Tabela principal de afiliados
create table if not exists public.afiliados (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade,
  email text not null,
  nome text,
  codigo text unique not null,
  carteira_ton text,
  destino text default 'https://orlandojaime833-ux.github.io/DIGIMARKET-',
  ativo boolean default true,
  total_cliques int default 0,
  total_conversoes int default 0,
  saldo_disponivel numeric(18,8) default 0,
  saldo_pago numeric(18,8) default 0,
  criado_em timestamptz default now()
);

-- Registo de cliques nos links mascarados
create table if not exists public.afiliado_cliques (
  id uuid default gen_random_uuid() primary key,
  afiliado_id uuid references public.afiliados(id) on delete cascade,
  ip text,
  user_agent text,
  referer text,
  criado_em timestamptz default now()
);

-- Comissões geradas
create table if not exists public.afiliado_comissoes (
  id uuid default gen_random_uuid() primary key,
  afiliado_id uuid references public.afiliados(id) on delete cascade,
  tipo text not null check (tipo in ('plano','loja')),
  descricao text,
  referencia_id text,
  valor_usd numeric(10,2) default 0,
  percentagem numeric(5,2) default 20,
  valor_ton numeric(18,8) not null,
  currency text default 'TONCOIN',
  status text default 'pendente' check (status in ('pendente','disponivel','pago','cancelado')),
  criado_em timestamptz default now(),
  pago_em timestamptz
);

-- Pedidos de saque
create table if not exists public.afiliado_saques (
  id uuid default gen_random_uuid() primary key,
  afiliado_id uuid references public.afiliados(id) on delete cascade,
  valor_ton numeric(18,8) not null,
  carteira_destino text not null,
  metodo text default 'ton' check (metodo in ('ton','xrocket')),
  taxa_rede numeric(18,8) default 0.01,
  valor_liquido numeric(18,8) not null,
  tx_hash text,
  status text default 'pendente' check (status in ('pendente','processando','pago','falhado')),
  criado_em timestamptz default now(),
  processado_em timestamptz
);

-- Links de afiliado por destino
create table if not exists public.afiliado_links (
  id uuid default gen_random_uuid() primary key,
  afiliado_id uuid references public.afiliados(id) on delete cascade,
  codigo text not null,
  destino text not null,
  destino_tipo text not null,
  cliques int default 0,
  criado_em timestamptz default now()
);

-- Lojas afiliadas (afiliado directo de uma loja)
create table if not exists public.afiliado_lojas (
  id uuid default gen_random_uuid() primary key,
  afiliado_id uuid references public.afiliados(id) on delete cascade,
  lojista_id uuid references public.lojistas(id) on delete cascade,
  ativo boolean default true,
  criado_em timestamptz default now(),
  unique(afiliado_id, lojista_id)
);

-- ════════════════════════════════════════════════════════
-- Função: incrementar cliques atomicamente
-- ════════════════════════════════════════════════════════
create or replace function public.incrementar_cliques(afiliado_id uuid)
returns void language plpgsql security definer as $$
begin
  update public.afiliados
  set total_cliques = total_cliques + 1
  where id = afiliado_id;
end;
$$;

-- ════════════════════════════════════════════════════════
-- RLS
-- ════════════════════════════════════════════════════════
alter table public.afiliados enable row level security;
alter table public.afiliado_cliques enable row level security;
alter table public.afiliado_comissoes enable row level security;
alter table public.afiliado_saques enable row level security;
alter table public.afiliado_links enable row level security;
alter table public.afiliado_lojas enable row level security;

-- Afiliado vê apenas os seus dados
create policy "afiliado_proprio" on public.afiliados
  for all using (auth.uid() = user_id);

create policy "cliques_proprio" on public.afiliado_cliques
  for select using (
    afiliado_id in (select id from public.afiliados where user_id = auth.uid())
  );

create policy "comissoes_proprio" on public.afiliado_comissoes
  for select using (
    afiliado_id in (select id from public.afiliados where user_id = auth.uid())
  );

create policy "saques_proprio" on public.afiliado_saques
  for all using (
    afiliado_id in (select id from public.afiliados where user_id = auth.uid())
  );

create policy "links_proprio" on public.afiliado_links
  for all using (
    afiliado_id in (select id from public.afiliados where user_id = auth.uid())
  );

create policy "lojas_proprio" on public.afiliado_lojas
  for select using (
    afiliado_id in (select id from public.afiliados where user_id = auth.uid())
  );
