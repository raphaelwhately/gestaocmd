-- CMD Gestão — execute uma única vez no SQL Editor do projeto Supabase/Lovable.
-- O proprietário do sistema só recebe acesso administrativo após confirmar o e-mail.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'user' check (role in ('user', 'system_owner')),
  created_at timestamptz not null default now()
);

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  logo_url text,
  phone text not null default '',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.store_members (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null,
  role text not null default 'cashier' check (role in ('owner', 'manager', 'cashier')),
  status text not null default 'invited' check (status in ('invited', 'active')),
  created_at timestamptz not null default now(),
  unique (store_id, user_id)
);
create unique index if not exists store_members_email_unique on public.store_members(store_id, lower(email));
create index if not exists store_members_user_idx on public.store_members(user_id, status);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  category text not null default 'Geral',
  code text not null default '',
  price numeric(12,2) not null check (price > 0),
  cost numeric(12,2) not null default 0 check (cost >= 0),
  stock integer not null default 0 check (stock >= 0),
  min_stock integer not null default 0 check (min_stock >= 0),
  emoji text not null default '📦',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists products_store_code_unique on public.products(store_id, code) where code <> '';
create index if not exists products_store_name_idx on public.products(store_id, name);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  phone text not null default '',
  email text not null default '',
  notes text not null default '',
  credit_limit numeric(12,2) check (credit_limit is null or credit_limit >= 0),
  created_at timestamptz not null default now()
);
create index if not exists customers_store_name_idx on public.customers(store_id, name);

create table if not exists public.cash_registers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  opened_by uuid not null references auth.users(id),
  closed_by uuid references auth.users(id),
  status text not null default 'open' check (status in ('open', 'closed')),
  opening_cash numeric(12,2) not null default 0 check (opening_cash >= 0),
  closing_cash numeric(12,2) check (closing_cash is null or closing_cash >= 0),
  opening_note text not null default '',
  closing_note text not null default '',
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index if not exists cash_register_one_open_per_store on public.cash_registers(store_id) where status = 'open';
create index if not exists cash_register_store_date_idx on public.cash_registers(store_id, opened_at desc);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  cash_register_id uuid not null references public.cash_registers(id),
  customer_id uuid references public.customers(id),
  created_by uuid not null references auth.users(id),
  payment_method text not null check (payment_method in ('Pix', 'Cartão', 'Dinheiro', 'Fiado')),
  status text not null default 'paid' check (status in ('paid', 'fiado')),
  subtotal numeric(12,2) not null check (subtotal >= 0),
  discount numeric(12,2) not null default 0 check (discount >= 0),
  total numeric(12,2) not null check (total >= 0),
  created_at timestamptz not null default now()
);
create index if not exists sales_store_date_idx on public.sales(store_id, created_at desc);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(12,2) not null check (line_total >= 0)
);
create index if not exists sale_items_sale_idx on public.sale_items(sale_id);

create table if not exists public.credit_accounts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  customer_id uuid not null references public.customers(id),
  sale_id uuid not null unique references public.sales(id),
  amount_due numeric(12,2) not null check (amount_due > 0),
  amount_paid numeric(12,2) not null default 0 check (amount_paid >= 0),
  due_date date,
  status text not null default 'open' check (status in ('open', 'paid')),
  created_at timestamptz not null default now()
);
create index if not exists credit_accounts_store_status_idx on public.credit_accounts(store_id, status, due_date);

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  cash_register_id uuid not null references public.cash_registers(id),
  created_by uuid not null references auth.users(id),
  type text not null check (type in ('sale', 'credit_payment', 'entry', 'withdrawal')),
  amount numeric(12,2) not null check (amount > 0),
  description text not null default '',
  sale_id uuid references public.sales(id),
  created_at timestamptz not null default now()
);
create index if not exists cash_movements_register_idx on public.cash_movements(cash_register_id, created_at);

create or replace function public.is_system_owner()
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'system_owner'
  );
$$;

create or replace function public.has_store_access(p_store_id uuid)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select public.is_system_owner() or exists (
    select 1 from public.store_members m
    where m.store_id = p_store_id and m.user_id = (select auth.uid()) and m.status = 'active'
  );
$$;

create or replace function public.can_manage_store(p_store_id uuid)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select public.is_system_owner() or exists (
    select 1 from public.store_members m
    where m.store_id = p_store_id and m.user_id = (select auth.uid())
      and m.status = 'active' and m.role in ('owner', 'manager')
  );
$$;

create or replace function public.is_store_owner(p_store_id uuid)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select public.is_system_owner() or exists (
    select 1 from public.store_members m
    where m.store_id = p_store_id and m.user_id = (select auth.uid())
      and m.status = 'active' and m.role = 'owner'
  );
$$;

create or replace function public.handle_auth_user()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  v_name text := coalesce(new.raw_user_meta_data ->> 'full_name', '');
  v_store_name text := coalesce(nullif(trim(new.raw_user_meta_data ->> 'store_name'), ''), 'Minha loja');
  v_linked integer := 0;
  v_store_id uuid;
begin
  insert into public.profiles(id, full_name, role)
  values (
    new.id, v_name,
    case when lower(coalesce(new.email, '')) = 'raphaelwhately@gmail.com'
      and new.email_confirmed_at is not null then 'system_owner' else 'user' end
  )
  on conflict (id) do update set
    full_name = case when excluded.full_name <> '' then excluded.full_name else public.profiles.full_name end,
    role = case when excluded.role = 'system_owner' then 'system_owner' else public.profiles.role end;

  if new.email_confirmed_at is not null and coalesce(new.email, '') <> '' then
    update public.store_members
    set user_id = new.id, status = 'active',
        full_name = case when v_name <> '' then v_name else full_name end
    where lower(email) = lower(new.email) and status = 'invited' and user_id is null;
    get diagnostics v_linked = row_count;
  end if;

  if v_linked = 0 and not exists (
    select 1 from public.store_members m
    where m.user_id = new.id and m.status = 'active' and m.role = 'owner'
  ) and not exists (
    select 1 from public.store_members m
    where lower(m.email) = lower(coalesce(new.email, ''))
      and m.status = 'invited' and m.user_id is null
  ) then
    insert into public.stores(name, created_by) values (v_store_name, new.id) returning id into v_store_id;
    insert into public.store_members(store_id, user_id, full_name, email, role, status)
    values (v_store_id, new.id, v_name, coalesce(new.email, ''), 'owner', 'active');
  end if;
  return new;
end;
$$;

create or replace function public.invite_employee(p_store_id uuid, p_full_name text, p_email text, p_role text)
returns uuid language plpgsql security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_member_id uuid;
begin
  if not public.can_manage_store(p_store_id) then raise exception 'Somente proprietário ou gerente pode convidar funcionários.'; end if;
  if p_role not in ('manager', 'cashier') then raise exception 'Cargo inválido.'; end if;
  if length(trim(coalesce(p_full_name, ''))) not between 1 and 120
     or position('@' in trim(coalesce(p_email, ''))) < 2 then
    raise exception 'Informe um nome e um e-mail válidos.';
  end if;
  select id into v_user_id from auth.users
  where lower(email) = lower(trim(p_email)) and email_confirmed_at is not null limit 1;
  insert into public.store_members(store_id, user_id, full_name, email, role, status)
  values (p_store_id, v_user_id, trim(p_full_name), lower(trim(p_email)), p_role,
          case when v_user_id is null then 'invited' else 'active' end)
  returning id into v_member_id;
  return v_member_id;
end;
$$;

drop trigger if exists on_auth_user_created_or_verified on auth.users;
create trigger on_auth_user_created_or_verified
after insert or update of email, email_confirmed_at on auth.users
for each row execute function public.handle_auth_user();

insert into public.profiles(id, full_name, role)
select u.id, coalesce(u.raw_user_meta_data ->> 'full_name', ''),
  case when lower(coalesce(u.email, '')) = 'raphaelwhately@gmail.com'
    and u.email_confirmed_at is not null then 'system_owner' else 'user' end
from auth.users u
on conflict (id) do update set
  role = case when excluded.role = 'system_owner' then 'system_owner' else public.profiles.role end;

-- Garante que a conta existente do proprietário tenha o perfil administrativo e uma loja acessível.
do $$
declare
  v_owner_id uuid;
  v_store_id uuid;
begin
  select id into v_owner_id from auth.users
  where lower(email) = 'raphaelwhately@gmail.com' and email_confirmed_at is not null
  limit 1;
  if v_owner_id is not null then
    update public.profiles set role = 'system_owner' where id = v_owner_id;
    if not exists (
      select 1 from public.store_members
      where user_id = v_owner_id and status = 'active' and role = 'owner'
    ) then
      insert into public.stores(name, created_by) values ('CMD Gestão', v_owner_id) returning id into v_store_id;
      insert into public.store_members(store_id, user_id, full_name, email, role, status)
      values (v_store_id, v_owner_id, 'Proprietário CMD Gestão', 'raphaelwhately@gmail.com', 'owner', 'active');
    end if;
  end if;
end $$;

create or replace function public.create_store(p_name text)
returns uuid language plpgsql security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_email text;
  v_name text;
begin
  if (select auth.uid()) is null or length(trim(coalesce(p_name, ''))) not between 1 and 100 then
    raise exception 'Informe um nome de loja válido.';
  end if;
  select email, full_name into v_email, v_name from public.profiles p
  join auth.users u on u.id = p.id where p.id = (select auth.uid());
  insert into public.stores(name, created_by) values (trim(p_name), (select auth.uid())) returning id into v_store_id;
  insert into public.store_members(store_id, user_id, full_name, email, role, status)
  values (v_store_id, (select auth.uid()), coalesce(v_name, ''), coalesce(v_email, ''), 'owner', 'active');
  return v_store_id;
end;
$$;

create or replace function public.admin_create_store(p_name text, p_owner_email text)
returns uuid language plpgsql security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_name text;
  v_store_id uuid;
begin
  if not public.is_system_owner() then raise exception 'Acesso restrito ao proprietário do sistema.'; end if;
  if length(trim(coalesce(p_name, ''))) not between 1 and 100 then raise exception 'Nome da loja inválido.'; end if;
  select u.id, coalesce(nullif(p.full_name, ''), u.raw_user_meta_data ->> 'full_name', p_owner_email)
  into v_owner_id, v_name
  from auth.users u left join public.profiles p on p.id = u.id
  where lower(u.email) = lower(trim(p_owner_email)) and u.email_confirmed_at is not null
  limit 1;
  if v_owner_id is null then raise exception 'O cliente precisa criar e confirmar a conta antes de receber uma loja.'; end if;
  insert into public.stores(name, created_by) values (trim(p_name), v_owner_id) returning id into v_store_id;
  insert into public.store_members(store_id, user_id, full_name, email, role, status)
  values (v_store_id, v_owner_id, v_name, lower(trim(p_owner_email)), 'owner', 'active');
  return v_store_id;
end;
$$;

create or replace function public.open_cash_register(p_store_id uuid, p_opening_cash numeric default 0, p_note text default '')
returns uuid language plpgsql security definer
set search_path = ''
as $$
declare v_register_id uuid;
begin
  if not public.has_store_access(p_store_id) then raise exception 'Você não tem acesso a esta loja.'; end if;
  if p_opening_cash < 0 then raise exception 'O saldo inicial não pode ser negativo.'; end if;
  insert into public.cash_registers(store_id, opened_by, opening_cash, opening_note)
  values (p_store_id, (select auth.uid()), p_opening_cash, coalesce(p_note, ''))
  returning id into v_register_id;
  return v_register_id;
end;
$$;

create or replace function public.close_cash_register(p_register_id uuid, p_closing_cash numeric, p_note text default '')
returns void language plpgsql security definer
set search_path = ''
as $$
declare v_store_id uuid;
begin
  if p_closing_cash < 0 then raise exception 'O valor de fechamento não pode ser negativo.'; end if;
  select store_id into v_store_id from public.cash_registers where id = p_register_id and status = 'open' for update;
  if v_store_id is null then raise exception 'Este caixa já está fechado ou não existe.'; end if;
  if not public.has_store_access(v_store_id) then raise exception 'Você não tem acesso a este caixa.'; end if;
  update public.cash_registers
  set status = 'closed', closing_cash = p_closing_cash, closing_note = coalesce(p_note, ''),
      closed_by = (select auth.uid()), closed_at = now()
  where id = p_register_id;
end;
$$;

create or replace function public.add_cash_movement(p_register_id uuid, p_type text, p_amount numeric, p_description text)
returns uuid language plpgsql security definer
set search_path = ''
as $$
declare v_store_id uuid; v_id uuid;
begin
  if p_type not in ('entry', 'withdrawal') or p_amount <= 0 then raise exception 'Tipo ou valor de movimentação inválido.'; end if;
  select store_id into v_store_id from public.cash_registers where id = p_register_id and status = 'open';
  if v_store_id is null or not public.has_store_access(v_store_id) then raise exception 'Não há caixa aberto acessível.'; end if;
  if not public.can_manage_store(v_store_id) then raise exception 'Somente proprietário ou gerente pode lançar entradas e retiradas.'; end if;
  insert into public.cash_movements(store_id, cash_register_id, created_by, type, amount, description)
  values (v_store_id, p_register_id, (select auth.uid()), p_type, p_amount, trim(coalesce(p_description, '')))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.complete_sale(
  p_store_id uuid, p_register_id uuid, p_items jsonb,
  p_payment_method text, p_customer_id uuid default null,
  p_discount numeric default 0, p_due_date date default null
)
returns uuid language plpgsql security definer
set search_path = ''
as $$
declare
  v_sale_id uuid;
  v_subtotal numeric(12,2) := 0;
  v_total numeric(12,2);
  v_product record;
  v_product_name text;
  v_unit_price numeric(12,2);
  v_customer_limit numeric(12,2);
  v_existing_debt numeric(12,2);
begin
  if not public.has_store_access(p_store_id) then raise exception 'Você não tem acesso a esta loja.'; end if;
  if p_payment_method not in ('Pix', 'Cartão', 'Dinheiro', 'Fiado') then raise exception 'Forma de pagamento inválida.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Adicione produtos à venda.'; end if;
  if p_discount < 0 then raise exception 'Desconto inválido.'; end if;
  perform 1 from public.cash_registers where id = p_register_id and store_id = p_store_id and status = 'open' for update;
  if not found then raise exception 'Abra o caixa desta loja antes de registrar a venda.'; end if;
  if p_payment_method = 'Fiado' and p_customer_id is null then raise exception 'Selecione um cliente para registrar uma venda fiada.'; end if;

  if p_customer_id is not null then
    select credit_limit into v_customer_limit from public.customers
    where id = p_customer_id and store_id = p_store_id for update;
    if not found then raise exception 'Cliente não encontrado nesta loja.'; end if;
  end if;

  for v_product in
    select x.product_id, sum(x.quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity integer)
    group by x.product_id
    order by x.product_id
  loop
    if v_product.product_id is null or v_product.quantity is null or v_product.quantity <= 0 then
      raise exception 'Produto ou quantidade inválida.';
    end if;
    perform 1 from public.products
    where id = v_product.product_id and store_id = p_store_id
      and stock >= v_product.quantity
    for update;
    if not found then raise exception 'Produto não encontrado ou estoque insuficiente. Atualize a venda e tente novamente.'; end if;
    select name, price into v_product_name, v_unit_price
    from public.products where id = v_product.product_id and store_id = p_store_id;
    v_subtotal := v_subtotal + v_unit_price * v_product.quantity;
  end loop;
  if p_discount > v_subtotal then raise exception 'O desconto não pode ultrapassar o subtotal.'; end if;
  v_total := v_subtotal - p_discount;
  if p_payment_method = 'Fiado' and v_customer_limit is not null then
    select coalesce(sum(amount_due - amount_paid), 0) into v_existing_debt
    from public.credit_accounts where customer_id = p_customer_id and status = 'open';
    if v_existing_debt + v_total > v_customer_limit then raise exception 'A venda ultrapassa o limite de fiado deste cliente.'; end if;
  end if;

  insert into public.sales(store_id, cash_register_id, customer_id, created_by, payment_method, status, subtotal, discount, total)
  values (p_store_id, p_register_id, p_customer_id, (select auth.uid()), p_payment_method,
          case when p_payment_method = 'Fiado' then 'fiado' else 'paid' end,
          v_subtotal, p_discount, v_total)
  returning id into v_sale_id;

  for v_product in
    select x.product_id, sum(x.quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity integer)
    group by x.product_id
    order by x.product_id
  loop
    update public.products set stock = stock - v_product.quantity, updated_at = now()
    where id = v_product.product_id and store_id = p_store_id
    returning name, price into v_product_name, v_unit_price;
    insert into public.sale_items(sale_id, store_id, product_id, product_name, quantity, unit_price, line_total)
    values (v_sale_id, p_store_id, v_product.product_id, v_product_name, v_product.quantity, v_unit_price,
            round(v_unit_price * v_product.quantity, 2));
  end loop;

  if p_payment_method = 'Fiado' then
    insert into public.credit_accounts(store_id, customer_id, sale_id, amount_due, due_date)
    values (p_store_id, p_customer_id, v_sale_id, v_total, p_due_date);
  elsif p_payment_method = 'Dinheiro' then
    insert into public.cash_movements(store_id, cash_register_id, created_by, type, amount, description, sale_id)
    values (p_store_id, p_register_id, (select auth.uid()), 'sale', v_total, 'Venda', v_sale_id);
  end if;
  return v_sale_id;
end;
$$;

create or replace function public.pay_credit(p_credit_id uuid, p_register_id uuid, p_amount numeric, p_payment_method text default 'Dinheiro')
returns void language plpgsql security definer
set search_path = ''
as $$
declare v_credit public.credit_accounts%rowtype; v_register_store uuid;
begin
  if p_amount <= 0 or p_payment_method not in ('Pix', 'Cartão', 'Dinheiro') then raise exception 'Valor ou forma de pagamento inválidos.'; end if;
  select * into v_credit from public.credit_accounts where id = p_credit_id and status = 'open' for update;
  if not found or not public.has_store_access(v_credit.store_id) then raise exception 'Fiado não encontrado ou sem acesso.'; end if;
  select store_id into v_register_store from public.cash_registers
  where id = p_register_id and store_id = v_credit.store_id and status = 'open' for update;
  if v_register_store is null then raise exception 'Abra o caixa da loja antes de receber o pagamento.'; end if;
  if p_amount > v_credit.amount_due - v_credit.amount_paid then raise exception 'O recebimento ultrapassa o saldo pendente.'; end if;
  update public.credit_accounts set amount_paid = amount_paid + p_amount,
    status = case when amount_paid + p_amount >= amount_due then 'paid' else 'open' end
  where id = p_credit_id;
  if p_payment_method = 'Dinheiro' then
    insert into public.cash_movements(store_id, cash_register_id, created_by, type, amount, description)
    values (v_credit.store_id, p_register_id, (select auth.uid()), 'credit_payment', p_amount, 'Recebimento de fiado');
  end if;
end;
$$;

alter table public.profiles enable row level security;
alter table public.stores enable row level security;
alter table public.store_members enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.cash_registers enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.credit_accounts enable row level security;
alter table public.cash_movements enable row level security;

drop policy if exists profiles_read_self_or_owner on public.profiles;
create policy profiles_read_self_or_owner on public.profiles for select to authenticated
using (id = (select auth.uid()) or public.is_system_owner());

drop policy if exists stores_read_member_or_owner on public.stores;
create policy stores_read_member_or_owner on public.stores for select to authenticated
using (public.has_store_access(id));
drop policy if exists stores_update_manager on public.stores;
create policy stores_update_manager on public.stores for update to authenticated
using (public.can_manage_store(id)) with check (public.can_manage_store(id));
drop policy if exists stores_delete_owner on public.stores;
create policy stores_delete_owner on public.stores for delete to authenticated
using (public.is_store_owner(id));

drop policy if exists members_read on public.store_members;
create policy members_read on public.store_members for select to authenticated
using (public.has_store_access(store_id));
drop policy if exists members_invite_manager on public.store_members;
create policy members_invite_manager on public.store_members for insert to authenticated
with check (public.can_manage_store(store_id) and role in ('manager', 'cashier') and status = 'invited' and user_id is null);
drop policy if exists members_update_manager on public.store_members;
create policy members_update_manager on public.store_members for update to authenticated
using (public.can_manage_store(store_id) and role <> 'owner')
with check (public.can_manage_store(store_id) and role in ('manager', 'cashier'));
drop policy if exists members_remove_manager on public.store_members;
create policy members_remove_manager on public.store_members for delete to authenticated
using (public.can_manage_store(store_id) and role <> 'owner');

drop policy if exists products_read_member on public.products;
create policy products_read_member on public.products for select to authenticated using (public.has_store_access(store_id));
drop policy if exists products_insert_manager on public.products;
create policy products_insert_manager on public.products for insert to authenticated with check (public.can_manage_store(store_id));
drop policy if exists products_update_manager on public.products;
create policy products_update_manager on public.products for update to authenticated using (public.can_manage_store(store_id)) with check (public.can_manage_store(store_id));
drop policy if exists products_delete_manager on public.products;
create policy products_delete_manager on public.products for delete to authenticated using (public.can_manage_store(store_id));

drop policy if exists customers_read_member on public.customers;
create policy customers_read_member on public.customers for select to authenticated using (public.has_store_access(store_id));
drop policy if exists customers_insert_member on public.customers;
create policy customers_insert_member on public.customers for insert to authenticated with check (public.has_store_access(store_id));
drop policy if exists customers_update_manager on public.customers;
create policy customers_update_manager on public.customers for update to authenticated using (public.can_manage_store(store_id)) with check (public.can_manage_store(store_id));
drop policy if exists customers_delete_manager on public.customers;
create policy customers_delete_manager on public.customers for delete to authenticated using (public.can_manage_store(store_id));

drop policy if exists cash_register_read_member on public.cash_registers;
create policy cash_register_read_member on public.cash_registers for select to authenticated using (public.has_store_access(store_id));
drop policy if exists sales_read_member on public.sales;
create policy sales_read_member on public.sales for select to authenticated using (public.has_store_access(store_id));
drop policy if exists sale_items_read_member on public.sale_items;
create policy sale_items_read_member on public.sale_items for select to authenticated using (public.has_store_access(store_id));
drop policy if exists credits_read_member on public.credit_accounts;
create policy credits_read_member on public.credit_accounts for select to authenticated using (public.has_store_access(store_id));
drop policy if exists movements_read_member on public.cash_movements;
create policy movements_read_member on public.cash_movements for select to authenticated using (public.has_store_access(store_id));

grant select on public.profiles to authenticated;
grant select, update, delete on public.stores to authenticated;
grant select, insert, update, delete on public.store_members to authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.customers to authenticated;
grant select on public.cash_registers, public.sales, public.sale_items, public.credit_accounts, public.cash_movements to authenticated;
revoke insert, update, delete on public.cash_registers, public.sales, public.sale_items, public.credit_accounts, public.cash_movements from anon, authenticated;

grant execute on function public.is_system_owner() to authenticated;
grant execute on function public.has_store_access(uuid) to authenticated;
grant execute on function public.can_manage_store(uuid) to authenticated;
grant execute on function public.is_store_owner(uuid) to authenticated;
grant execute on function public.create_store(text) to authenticated;
grant execute on function public.admin_create_store(text, text) to authenticated;
grant execute on function public.invite_employee(uuid, text, text, text) to authenticated;
grant execute on function public.open_cash_register(uuid, numeric, text) to authenticated;
grant execute on function public.close_cash_register(uuid, numeric, text) to authenticated;
grant execute on function public.add_cash_movement(uuid, text, numeric, text) to authenticated;
grant execute on function public.complete_sale(uuid, uuid, jsonb, text, uuid, numeric, date) to authenticated;
grant execute on function public.pay_credit(uuid, uuid, numeric, text) to authenticated;
revoke all on function public.handle_auth_user() from public, anon, authenticated;
revoke all on function public.is_system_owner() from public, anon;
revoke all on function public.has_store_access(uuid) from public, anon;
revoke all on function public.can_manage_store(uuid) from public, anon;
revoke all on function public.is_store_owner(uuid) from public, anon;
revoke all on function public.create_store(text) from public, anon;
revoke all on function public.admin_create_store(text, text) from public, anon;
revoke all on function public.invite_employee(uuid, text, text, text) from public, anon;
revoke all on function public.open_cash_register(uuid, numeric, text) from public, anon;
revoke all on function public.close_cash_register(uuid, numeric, text) from public, anon;
revoke all on function public.add_cash_movement(uuid, text, numeric, text) from public, anon;
revoke all on function public.complete_sale(uuid, uuid, jsonb, text, uuid, numeric, date) from public, anon;
revoke all on function public.pay_credit(uuid, uuid, numeric, text) from public, anon;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('store-logos', 'store-logos', true, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 3145728,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists store_logo_public_read on storage.objects;
create policy store_logo_public_read on storage.objects for select to public
using (bucket_id = 'store-logos');
drop policy if exists store_logo_manager_insert on storage.objects;
create policy store_logo_manager_insert on storage.objects for insert to authenticated
with check (bucket_id = 'store-logos' and public.can_manage_store((storage.foldername(name))[1]::uuid));
drop policy if exists store_logo_manager_update on storage.objects;
create policy store_logo_manager_update on storage.objects for update to authenticated
using (bucket_id = 'store-logos' and public.can_manage_store((storage.foldername(name))[1]::uuid))
with check (bucket_id = 'store-logos' and public.can_manage_store((storage.foldername(name))[1]::uuid));
drop policy if exists store_logo_manager_delete on storage.objects;
create policy store_logo_manager_delete on storage.objects for delete to authenticated
using (bucket_id = 'store-logos' and public.can_manage_store((storage.foldername(name))[1]::uuid));
