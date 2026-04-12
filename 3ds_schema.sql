-- ════════════════════════════════════════════════════════
-- 3DigitalShop — Schema Completo v3.0
-- Cola no SQL Editor do Supabase e clica "Run"
-- ════════════════════════════════════════════════════════

-- Planos disponíveis
create table if not exists public.planos (
  id text primary key,
  nome text not null,
  ton numeric(10,4) not null,
  max_produtos int not null,
  max_imgs int default 3,
  suporte text default 'basico',
  ia_descricao boolean default false,
  promocoes boolean default false,
  redes_sociais boolean default false,
  campanhas boolean default false,
  suporte_dedicado boolean default false,
  recursos_gratuitos boolean default true,
  ativo boolean default true,
  ordem int default 0
);

insert into public.planos values
  ('amador',      'Amador',       0.5,  1,  2, 'basico',     false, false, false, false, false, true, true, 1),
  ('simples',     'Simples',      1.5,  2,  3, 'basico',     false, false, false, false, false, true, true, 2),
  ('iniciante',   'Iniciante',    3.0,  5,  4, 'prioritario',false, false, false, false, false, true, true, 3),
  ('basico',      'Básico',       5.0,  10, 5, 'prioritario',false, true,  false, false, false, true, true, 4),
  ('classico',    'Clássico',     8.0,  15, 6, 'prioritario',true,  true,  true,  false, false, true, true, 5),
  ('profissional','Profissional', 10.0, 20, 8, 'dedicado',   true,  true,  true,  true,  true,  true, true, 6)
on conflict (id) do update set
  nome=excluded.nome, ton=excluded.ton, max_produtos=excluded.max_produtos;

-- Lojistas
create table if not exists public.lojistas (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  nome_loja text default 'A Minha Loja',
  descricao text,
  logo_url text,
  banner_url text,
  slug text unique,
  link_mascarado text unique,
  instagram text,
  facebook text,
  tiktok text,
  youtube text,
  website text,
  dominio_personalizado text,
  plano_id text references public.planos(id) default 'amador',
  plano_expira_em timestamptz,
  status text default 'active' check (status in ('active','inactive','suspended')),
  total_cliques int default 0,
  total_produtos int default 0,
  ai_contexto text,
  criado_em timestamptz default now()
);

-- Produtos (link externo — sem processamento de pagamento)
create table if not exists public.produtos (
  id uuid default gen_random_uuid() primary key,
  lojista_id uuid references public.lojistas(id) on delete cascade,
  nome text not null,
  descricao text,
  descricao_ia text,
  preco numeric(10,2),
  preco_original numeric(10,2),
  moeda text default 'USD',
  imagens text[] default '{}',
  categoria text,
  tags text[] default '{}',
  link_externo text not null,
  provedor text,
  seo_titulo text,
  seo_descricao text,
  seo_tags text[] default '{}',
  total_cliques int default 0,
  total_views int default 0,
  media_reviews numeric(3,2) default 0,
  total_reviews int default 0,
  ativo boolean default true,
  destaque boolean default false,
  criado_em timestamptz default now()
);

-- Reviews
create table if not exists public.reviews (
  id uuid default gen_random_uuid() primary key,
  produto_id uuid references public.produtos(id) on delete cascade,
  user_id uuid references auth.users on delete set null,
  email text,
  estrelas int check (estrelas between 1 and 5),
  comentario text,
  verificado boolean default false,
  criado_em timestamptz default now()
);

-- Cliques nos produtos (analytics)
create table if not exists public.produto_cliques (
  id uuid default gen_random_uuid() primary key,
  produto_id uuid references public.produtos(id) on delete cascade,
  lojista_id uuid references public.lojistas(id) on delete cascade,
  ip text,
  user_agent text,
  criado_em timestamptz default now()
);

-- Pagamentos de planos (TON Connect)
create table if not exists public.pagamentos (
  id uuid default gen_random_uuid() primary key,
  lojista_id uuid references public.lojistas(id) on delete cascade,
  plano_id text references public.planos(id),
  valor_ton numeric(18,8) not null,
  currency text default 'TONCOIN',
  invoice_id text unique,
  invoice_link text,
  tx_hash text,
  status text default 'pending' check (status in ('pending','confirmed','failed')),
  ref_afiliado text,
  criado_em timestamptz default now(),
  confirmado_em timestamptz
);

-- Afiliados
create table if not exists public.afiliados (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade unique,
  email text not null,
  nome text,
  codigo text unique not null,
  carteira_ton text,
  destino text,
  ativo boolean default true,
  total_cliques int default 0,
  total_conversoes int default 0,
  saldo_disponivel numeric(18,8) default 0,
  saldo_pago numeric(18,8) default 0,
  criado_em timestamptz default now()
);

-- Cliques de afiliados
create table if not exists public.afiliado_cliques (
  id uuid default gen_random_uuid() primary key,
  afiliado_id uuid references public.afiliados(id) on delete cascade,
  ip text,
  user_agent text,
  criado_em timestamptz default now()
);

-- Comissões de afiliados (10% dos planos)
create table if not exists public.afiliado_comissoes (
  id uuid default gen_random_uuid() primary key,
  afiliado_id uuid references public.afiliados(id) on delete cascade,
  lojista_id uuid references public.lojistas(id),
  plano_id text,
  valor_ton numeric(18,8) not null,
  percentagem numeric(5,2) default 10,
  referencia_id text unique,
  status text default 'disponivel' check (status in ('disponivel','pago','cancelado')),
  criado_em timestamptz default now(),
  pago_em timestamptz
);

-- Saques de afiliados
create table if not exists public.afiliado_saques (
  id uuid default gen_random_uuid() primary key,
  afiliado_id uuid references public.afiliados(id) on delete cascade,
  valor_ton numeric(18,8) not null,
  carteira_destino text not null,
  taxa_rede numeric(18,8) default 0.01,
  valor_liquido numeric(18,8) not null,
  tx_hash text,
  status text default 'pendente' check (status in ('pendente','processando','pago','falhado')),
  criado_em timestamptz default now(),
  processado_em timestamptz
);

-- Histórico de chat com Claude AI (por sessão/utilizador)
create table if not exists public.ai_conversas (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade,
  lojista_id uuid references public.lojistas(id) on delete cascade,
  contexto text default 'lojista',
  mensagens jsonb default '[]',
  criado_em timestamptz default now(),
  actualizado_em timestamptz default now()
);

-- Automações por loja
create table if not exists public.automacoes (
  id uuid default gen_random_uuid() primary key,
  lojista_id uuid references public.lojistas(id) on delete cascade,
  tipo text not null,
  nome text not null,
  ativa boolean default false,
  config jsonb default '{}',
  ultima_execucao timestamptz,
  criado_em timestamptz default now()
);

-- Templates de marketing (afiliados VIP)
create table if not exists public.templates_marketing (
  id uuid default gen_random_uuid() primary key,
  tipo text check (tipo in ('banner','post','email','video_script')),
  nome text,
  conteudo text,
  preview_url text,
  plano_minimo text default 'todos',
  criado_em timestamptz default now()
);

-- Config da plataforma
create table if not exists public.config_plataforma (
  id int primary key default 1,
  nome_plataforma text default '3DigitalShop',
  xrocket_api_key text default '2b95ea2ad1f9a2d53563a05d4',
  ton_usd_rate numeric(10,4) default 5.0,
  comissao_afiliado numeric(5,2) default 10.0,
  taxa_rede_ton numeric(10,8) default 0.01,
  anthropic_api_key text,
  dominio_plataforma text default 'orlandojaime833-ux.github.io/DIGIMARKET-',
  backend_url text default 'https://digimarket-h0vk.onrender.com',
  manutencao boolean default false
);

insert into public.config_plataforma (id) values (1) on conflict (id) do nothing;

-- ════════════════════════════════════════════════════════
-- FUNÇÕES
-- ════════════════════════════════════════════════════════
create or replace function public.incrementar_cliques(afiliado_id uuid)
returns void language plpgsql security definer as $$
begin
  update public.afiliados set total_cliques = total_cliques + 1 where id = afiliado_id;
end;$$;

create or replace function public.actualizar_media_reviews()
returns trigger language plpgsql security definer as $$
begin
  update public.produtos set
    media_reviews = (select coalesce(avg(estrelas),0) from public.reviews where produto_id = NEW.produto_id),
    total_reviews = (select count(*) from public.reviews where produto_id = NEW.produto_id)
  where id = NEW.produto_id;
  return NEW;
end;$$;

drop trigger if exists trig_reviews on public.reviews;
create trigger trig_reviews after insert or update or delete on public.reviews
  for each row execute procedure public.actualizar_media_reviews();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.lojistas (id, email, slug)
  values (new.id, new.email, 'loja-' || substring(new.id::text,1,8))
  on conflict (id) do nothing;
  return new;
end;$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ════════════════════════════════════════════════════════
-- RLS
-- ════════════════════════════════════════════════════════
alter table public.lojistas enable row level security;
alter table public.produtos enable row level security;
alter table public.pagamentos enable row level security;
alter table public.afiliados enable row level security;
alter table public.afiliado_cliques enable row level security;
alter table public.afiliado_comissoes enable row level security;
alter table public.afiliado_saques enable row level security;
alter table public.ai_conversas enable row level security;
alter table public.automacoes enable row level security;
alter table public.reviews enable row level security;
alter table public.config_plataforma enable row level security;
alter table public.produto_cliques enable row level security;
alter table public.planos enable row level security;

create policy "planos_publicos" on public.planos for select using (ativo = true);
create policy "lojista_proprio" on public.lojistas for all using (auth.uid() = id);
create policy "lojistas_publicas" on public.lojistas for select using (status = 'active');
create policy "produtos_proprio" on public.produtos for all using (auth.uid() = lojista_id);
create policy "produtos_publicos" on public.produtos for select using (ativo = true);
create policy "pagamentos_proprio" on public.pagamentos for all using (auth.uid() = lojista_id);
create policy "afiliado_proprio" on public.afiliados for all using (auth.uid() = user_id);
create policy "comissoes_proprio" on public.afiliado_comissoes for select using (afiliado_id in (select id from public.afiliados where user_id = auth.uid()));
create policy "saques_proprio" on public.afiliado_saques for all using (afiliado_id in (select id from public.afiliados where user_id = auth.uid()));
create policy "ai_proprio" on public.ai_conversas for all using (auth.uid() = user_id);
create policy "automacoes_proprio" on public.automacoes for all using (auth.uid() = lojista_id);
create policy "reviews_publicas" on public.reviews for select using (true);
create policy "reviews_insert" on public.reviews for insert with check (true);
create policy "cliques_insert" on public.produto_cliques for insert with check (true);
create policy "config_service" on public.config_plataforma for all using (false);
create policy "templates_publicos" on public.templates_marketing for select using (true);
