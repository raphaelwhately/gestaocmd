import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const app = document.querySelector("#app");
const money = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const dateTime = (value) => value ? new Date(value).toLocaleString("pt-BR") : "—";
const dateOnly = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR") : "Sem vencimento";
const today = () => new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
const isToday = (value) => new Date(value).toDateString() === new Date().toDateString();
const lowStock = (product) => Number(product.stock) <= Number(product.min_stock);
const OWNER_EMAIL = "raphaelwhately@gmail.com";

let supabase;
let authView = "login";
let state = {
  user: null, profile: null, stores: [], store: null, products: [], sales: [], customers: [],
  members: [], credits: [], registers: [], movements: [], register: null, page: "dashboard",
  category: "Todos", query: "", cart: [], payment: "Pix", reportStart: "", reportEnd: ""
};

function toast(message, error = false) {
  const root = document.querySelector("#toast-root");
  const node = document.createElement("div");
  node.className = `toast${error ? " error" : ""}`;
  node.textContent = message;
  root.append(node);
  window.setTimeout(() => node.remove(), 4000);
}

function fail(error, fallback = "Não foi possível concluir esta ação.") {
  console.error(error);
  toast(error?.message || fallback, true);
}

function resultOrThrow(result) {
  if (result.error) throw result.error;
  return result.data;
}

function isOwner() { return state.profile?.role === "system_owner"; }
function canManage() {
  const member = state.members.find((row) => row.user_id === state.user?.id && row.status === "active");
  return isOwner() || ["owner", "manager"].includes(member?.role);
}

function authShell() {
  document.querySelector(".topbar").hidden = true;
  const configured = Boolean(supabase);
  const setup = `<section class="auth-config"><p class="eyebrow">Conectar seu banco de dados</p><h2>Configure o Supabase da Lovable</h2><p>Informe a URL do projeto e a chave pública anon/publishable. Nunca use a chave <code>service_role</code>.</p>
    <form id="config-form"><label class="form-field"><span>URL do projeto</span><input class="input" name="url" required type="url" placeholder="https://seu-projeto.supabase.co" /></label><label class="form-field"><span>Chave pública (anon / publishable)</span><input class="input" name="anonKey" required autocomplete="off" /></label><button class="button button-primary">Conectar banco</button></form></section>`;
  const form = authView === "signup" ? `<form id="auth-form"><label class="form-field"><span>Seu nome</span><input class="input" name="fullName" required maxlength="120" autocomplete="name" /></label><label class="form-field"><span>Nome da loja</span><input class="input" name="storeName" required maxlength="100" autocomplete="organization" /></label><label class="form-field"><span>E-mail</span><input class="input" name="email" required type="email" autocomplete="email" /></label><label class="form-field"><span>Senha (mínimo 8 caracteres)</span><input class="input" name="password" required type="password" minlength="8" autocomplete="new-password" /></label><button class="button button-primary auth-submit">Criar conta e loja</button><button type="button" class="plain-link auth-toggle" data-action="auth-login">Já tenho conta · Entrar</button></form>` :
    `<form id="auth-form"><label class="form-field"><span>E-mail</span><input class="input" name="email" required type="email" autocomplete="email" /></label><label class="form-field"><span>Senha</span><input class="input" name="password" required type="password" autocomplete="current-password" /></label><button class="button button-primary auth-submit">Entrar na minha conta</button><button type="button" class="plain-link auth-toggle" data-action="auth-signup">Criar minha loja</button><button type="button" class="plain-link auth-toggle" data-action="forgot-password">Esqueci minha senha</button></form>`;
  app.innerHTML = `<div class="auth-layout"><section class="auth-brand"><a class="brand" href="#"><span class="brand-mark">c</span><span class="brand-copy"><strong>cmd<span>.</span></strong><small>GESTÃO</small></span></a><div><p class="eyebrow">Sua operação, em boas mãos</p><h1>Venda com leveza.<br />Gerencie com confiança.</h1><p>Estoque, equipe, clientes e caixa em um só lugar.</p></div><span>CMD Gestão · controle simples para sua loja</span></section>
    <section class="auth-card"><p class="eyebrow">Acesso seguro à sua loja</p><h1>${configured ? (authView === "signup" ? "Crie sua conta" : "Bem-vindo de volta") : "Quase pronto!"}</h1>
    <p class="subtitle">${configured ? "Entre para continuar gerenciando seu negócio." : "Conecte as credenciais públicas do projeto para ativar contas e banco de dados."}</p>
    ${configured ? form : setup}<div class="auth-hint">Cada loja tem seus próprios dados e acessos. Funcionários entram com a própria conta.</div></section></div>`;
}

function pageHeading(eyebrow, title, subtitle, right = "") {
  return `<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="subtitle">${subtitle}</p></div>${right}</div>`;
}

function metricCard(label, value, foot, icon) {
  return `<article class="metric-card"><div class="metric-top"><span class="metric-label">${label}</span><span class="metric-icon">${icon}</span></div><div class="metric-value">${value}</div><div class="metric-foot">${foot}</div></article>`;
}

function chartMarkup(sales) {
  const values = Array.from({ length: 7 }, (_, index) => {
    const day = new Date();
    day.setDate(day.getDate() - (6 - index));
    return sales.filter((sale) => new Date(sale.created_at).toDateString() === day.toDateString()).reduce((sum, sale) => sum + Number(sale.total), 0);
  });
  const max = Math.max(...values, 1) * 1.2;
  const x0 = 37, x1 = 590, y1 = 168;
  const points = values.map((value, index) => `${x0 + (x1 - x0) * index / 6},${y1 - (value / max) * 145}`).join(" ");
  const pointArray = points.split(" ").map((point) => point.split(",").map(Number));
  const dates = Array.from({ length: 7 }, (_, index) => {
    const day = new Date();
    day.setDate(day.getDate() - (6 - index));
    return day.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  });
  return `<svg class="sales-chart" viewBox="0 0 610 205" role="img" aria-label="Vendas dos últimos sete dias"><defs><linearGradient id="salesFade" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#ee762f" stop-opacity=".22"/><stop offset="100%" stop-color="#ee762f" stop-opacity="0"/></linearGradient></defs>
    ${[0,1,2,3].map((line) => `<line class="chart-grid" x1="34" x2="596" y1="${22 + line * 44}" y2="${22 + line * 44}"/>`).join("")}<polygon class="chart-area" points="37,168 ${points} 590,168"/><polyline class="chart-line" points="${points}"/>${pointArray.map((point) => `<circle class="chart-dot" cx="${point[0]}" cy="${point[1]}" r="3.6"/>`).join("")}
    ${values.some(Boolean) ? "" : `<text class="chart-label" text-anchor="middle" x="313" y="94">Suas vendas aparecerão aqui</text>`}${dates.map((date, index) => `<text class="chart-label" text-anchor="middle" x="${x0 + (x1 - x0) * index / 6}" y="194">${date}</text>`).join("")}</svg>`;
}

function dashboardPage() {
  const salesToday = state.sales.filter((sale) => isToday(sale.created_at));
  const total = salesToday.reduce((sum, sale) => sum + Number(sale.total), 0);
  const units = salesToday.reduce((sum, sale) => sum + (sale.sale_items || []).reduce((n, item) => n + item.quantity, 0), 0);
  const inventory = state.products.reduce((sum, item) => sum + item.stock, 0);
  const alerts = state.products.filter(lowStock).sort((a, b) => a.stock - b.stock);
  const ranking = {};
  state.sales.forEach((sale) => (sale.sale_items || []).forEach((item) => { ranking[item.product_name] = (ranking[item.product_name] || 0) + item.quantity; }));
  const top = Object.entries(ranking).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const recent = state.sales.slice(0, 4);
  return `${pageHeading("Painel da loja", `Olá, ${escapeHtml(state.profile?.full_name?.split(" ")[0] || "tudo bem")}! 👋`, `Resumo de ${escapeHtml(state.store?.name || "sua loja")} · ${today()}`, `<div class="date-label">${state.register ? "● Caixa aberto" : "○ Caixa fechado"}</div>`)}
    <section class="metric-grid">${metricCard("Vendas de hoje", money(total), `${salesToday.length} venda${salesToday.length === 1 ? "" : "s"} concluída${salesToday.length === 1 ? "" : "s"}`, "↗")}${metricCard("Itens vendidos", units.toLocaleString("pt-BR"), "unidades hoje", "▦")}${metricCard("Produtos em estoque", inventory.toLocaleString("pt-BR"), `${state.products.length} produtos`, "▣")}${metricCard("Precisam de reposição", alerts.length, alerts.length ? "confira os itens abaixo" : "estoque em dia", "⚑")}</section>
    <section class="dashboard-grid"><article class="panel"><div class="panel-header"><div><h2 class="panel-title">Movimento de vendas</h2><p class="panel-note">Faturamento nos últimos sete dias</p></div><span class="chart-legend"><i></i>Vendas</span></div><div class="chart-wrap">${chartMarkup(state.sales)}</div></article>
    <article class="panel"><div class="panel-header"><div><h2 class="panel-title">Mais vendidos</h2><p class="panel-note">Com base nas vendas desta loja</p></div><button class="plain-link" data-page="reports">Relatórios →</button></div><div class="top-products">${top.length ? top.map(([name, quantity]) => `<div class="top-product"><span class="product-emoji">📦</span><div><div class="product-name">${escapeHtml(name)}</div><div class="product-sub">No histórico de vendas</div></div><span class="product-amount">${quantity} un.</span></div>`).join("") : `<div class="empty-state">Os produtos mais vendidos aparecerão aqui.</div>`}</div></article></section>
    <section class="lower-grid"><article class="panel"><div class="panel-header"><div><h2 class="panel-title">Estoque para conferir</h2><p class="panel-note">Produtos no limite ou abaixo do mínimo</p></div><button class="plain-link" data-page="products">Ver estoque →</button></div>${stockTable(alerts.slice(0, 5), true)}</article>
    <article class="panel"><div class="panel-header"><div><h2 class="panel-title">Últimas vendas</h2><p class="panel-note">Movimento recente desta loja</p></div><button class="plain-link" data-page="reports">Ver todas →</button></div><div class="activity-list">${recent.length ? recent.map((sale) => `<div class="activity-row"><div><div class="activity-description">Venda #${escapeHtml(sale.id.slice(0, 8))}</div><div class="activity-meta">${dateTime(sale.created_at)} · ${escapeHtml(sale.payment_method)}</div></div><span class="activity-value">${money(sale.total)}</span></div>`).join("") : `<div class="empty-state">Suas vendas aparecerão aqui.</div>`}</div></article></section>`;
}

function stockTable(products, compact = false) {
  if (!products.length) return `<div class="empty-state">Tudo certo por aqui. Nenhum produto precisa de atenção.</div>`;
  return `<div class="table-wrap"><table><thead><tr><th>Produto</th><th>Estoque atual</th><th>Mínimo</th><th>Situação</th>${compact ? "" : "<th>Preço</th>"}</tr></thead><tbody>${products.map((product) => `<tr><td><span class="stock-name"><span class="product-emoji">${escapeHtml(product.emoji)}</span>${escapeHtml(product.name)}</span></td><td><strong>${product.stock}</strong> un.</td><td>${product.min_stock} un.</td><td><span class="badge ${product.stock === 0 ? "badge-out" : "badge-low"}">${product.stock === 0 ? "Sem estoque" : "Estoque baixo"}</span></td>${compact ? "" : `<td>${money(product.price)}</td>`}</tr>`).join("")}</tbody></table></div>`;
}

function productsPage() {
  const q = state.query.toLocaleLowerCase("pt-BR");
  const products = state.products.filter((product) => [product.name, product.category, product.code].some((value) => String(value || "").toLocaleLowerCase("pt-BR").includes(q)));
  const right = `<div class="toolbar"><label class="search-field"><input id="search" class="input" placeholder="Buscar produto ou código..." value="${escapeHtml(state.query)}" /></label>${canManage() ? `<button class="button button-primary" data-action="new-product">＋ Novo produto</button>` : ""}</div>`;
  return `${pageHeading("Catálogo e inventário", "Seus produtos", "Cadastre e acompanhe os itens desta loja.", right)}<div class="inventory-summary"><span><strong>${state.products.length}</strong> produtos</span><span><strong>${state.products.reduce((sum, p) => sum + p.stock, 0)}</strong> unidades</span><span><strong>${state.products.filter(lowStock).length}</strong> precisam de reposição</span></div><section class="panel">${productTable(products)}</section>`;
}

function productTable(products) {
  if (!products.length) return `<div class="empty-state">Nenhum produto encontrado.</div>`;
  return `<div class="table-wrap"><table class="inventory-table"><thead><tr><th>Produto</th><th>Código</th><th>Categoria</th><th>Preço</th><th>Estoque</th><th>Situação</th><th></th></tr></thead><tbody>${products.map((p) => `<tr><td><span class="stock-name"><span class="product-emoji">${escapeHtml(p.emoji)}</span>${escapeHtml(p.name)}</span></td><td>${escapeHtml(p.code || "—")}</td><td>${escapeHtml(p.category)}</td><td><strong>${money(p.price)}</strong></td><td><strong>${p.stock}</strong> <span class="product-sub">/ mín. ${p.min_stock}</span></td><td>${lowStock(p) ? `<span class="badge ${p.stock ? "badge-low" : "badge-out"}">${p.stock ? "Baixo" : "Sem estoque"}</span>` : `<span class="badge badge-good">Em dia</span>`}</td><td><div class="row-actions">${canManage() ? `<button class="text-action" data-action="restock" data-id="${p.id}">+ Repor</button><button class="text-action" data-action="edit-product" data-id="${p.id}">Editar</button><button class="text-action" data-action="delete-product" data-id="${p.id}">Excluir</button>` : ""}</div></td></tr>`).join("")}</tbody></table></div>`;
}

function cartTotal() { return Math.max(0, state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0) - (state.discount || 0)); }

function salesPage() {
  const q = state.query.trim().toLocaleLowerCase("pt-BR");
  const categories = ["Todos", ...new Set(state.products.map((product) => product.category))];
  const products = state.products.filter((product) => product.stock > 0 && (state.category === "Todos" || product.category === state.category) && [product.name, product.code].some((value) => String(value || "").toLocaleLowerCase("pt-BR").includes(q)));
  const cart = `<aside class="panel cart-panel"><div class="panel-header"><div><h2 class="panel-title">Venda atual</h2><p class="panel-note">${state.cart.reduce((sum, item) => sum + item.quantity, 0)} itens</p></div><button class="text-action" data-action="clear-cart">Limpar</button></div>
    <div class="cart-body">${state.cart.length ? state.cart.map((item) => `<div class="cart-item"><div><div class="cart-item-title">${escapeHtml(item.name)}</div><div class="cart-item-price">${money(item.price)} cada · ${money(item.price * item.quantity)}</div></div><div class="qty-controls"><button data-action="cart-minus" data-id="${item.id}">−</button><span>${item.quantity}</span><button data-action="cart-plus" data-id="${item.id}">+</button></div></div>`).join("") : `<div class="cart-empty"><span>🛒</span>Seu carrinho está vazio.<br>Toque em um produto para começar.</div>`}</div>
    <div class="cart-footer"><div class="cart-total-row"><span>Total da venda</span><strong>${money(cartTotal())}</strong></div><button class="button button-primary" data-action="checkout" ${!state.cart.length || !state.register ? "disabled" : ""}>${state.register ? "Finalizar venda →" : "Abra o caixa para vender"}</button></div></aside>`;
  return `${pageHeading("Ponto de venda", "Nova venda", "Encontre os produtos e monte o pedido do cliente.", `<label class="search-field"><input id="search" class="input" placeholder="Produto ou código..." value="${escapeHtml(state.query)}" /></label>`)}
    ${state.register ? "" : `<div class="notice notice-warn">Para registrar vendas, abra o caixa desta loja. <button class="plain-link" data-page="cash">Abrir caixa →</button></div>`}
    <section class="sales-layout"><div><div class="category-pills">${categories.map((c) => `<button class="category-pill ${state.category === c ? "active" : ""}" data-action="category" data-value="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join("")}</div><div class="sales-products">${products.length ? products.map((p) => `<button class="sale-card" data-action="add-cart" data-id="${p.id}"><span class="product-emoji">${escapeHtml(p.emoji)}</span><div class="product-name">${escapeHtml(p.name)}</div><div class="product-sub">${p.stock} disponíveis · ${escapeHtml(p.category)}</div><div class="sale-price-row"><span class="sale-price">${money(p.price)}</span><span class="add-circle">+</span></div></button>`).join("") : `<div class="empty-state">Nenhum produto disponível para esta busca.</div>`}</div></div>${cart}</section>`;
}

function customersPage() {
  const q = state.query.toLocaleLowerCase("pt-BR");
  const rows = state.customers.filter((c) => `${c.name} ${c.phone} ${c.email}`.toLocaleLowerCase("pt-BR").includes(q));
  return `${pageHeading("Relacionamento", "Clientes", "Cadastre clientes para organizar contatos e vendas fiadas.", `<div class="toolbar"><label class="search-field"><input id="search" class="input" placeholder="Buscar cliente..." value="${escapeHtml(state.query)}" /></label><button class="button button-primary" data-action="new-customer">＋ Novo cliente</button></div>`)}
    <section class="panel"><div class="table-wrap"><table><thead><tr><th>Nome</th><th>Telefone</th><th>E-mail</th><th>Limite de fiado</th><th>Cadastrado em</th><th></th></tr></thead><tbody>${rows.length ? rows.map((c) => `<tr><td><strong>${escapeHtml(c.name)}</strong></td><td>${escapeHtml(c.phone || "—")}</td><td>${escapeHtml(c.email || "—")}</td><td>${c.credit_limit == null ? "Sem limite" : money(c.credit_limit)}</td><td>${new Date(c.created_at).toLocaleDateString("pt-BR")}</td><td>${canManage() ? `<button class="text-action" data-action="edit-customer" data-id="${c.id}">Editar</button>` : ""}</td></tr>`).join("") : `<tr><td colspan="6"><div class="empty-state">Cadastre seu primeiro cliente.</div></td></tr>`}</tbody></table></div></section>`;
}

function creditsPage() {
  const open = state.credits.filter((c) => c.status === "open");
  const balance = (credit) => Math.max(0, Number(credit.amount_due) - Number(credit.amount_paid));
  const totalDebt = open.reduce((sum, c) => sum + balance(c), 0);
  return `${pageHeading("Contas a receber", "Fiado", "Acompanhe saldos em aberto e registre pagamentos de clientes.", `<div class="date-label">${open.length} em aberto · ${money(totalDebt)}</div>`)}
    <section class="metric-grid">${metricCard("Saldo a receber", money(totalDebt), `${open.length} contas em aberto`, "R$")}${metricCard("Recebidos", money(state.credits.reduce((sum,c)=>sum+Number(c.amount_paid),0)), "pagamentos registrados", "✓")}${metricCard("Vencidos", open.filter((c) => c.due_date && new Date(`${c.due_date}T23:59:59`) < new Date()).length, "contas fora do prazo", "⌛")}${metricCard("Clientes cadastrados", state.customers.length, "nesta loja", "♙")}</section>
    <section class="panel section-spacer"><div class="panel-header"><div><h2 class="panel-title">Contas de fiado</h2><p class="panel-note">Cada conta está vinculada a uma venda e cliente</p></div></div><div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Venda</th><th>Data</th><th>Vencimento</th><th>Valor inicial</th><th>Saldo</th><th>Status</th><th></th></tr></thead><tbody>${state.credits.length ? state.credits.map((c) => `<tr><td><strong>${escapeHtml(c.customers?.name || "Cliente")}</strong></td><td>#${escapeHtml(c.sale_id.slice(0,8))}</td><td>${dateTime(c.created_at)}</td><td>${dateOnly(c.due_date)}</td><td>${money(c.amount_due)}</td><td><strong>${money(balance(c))}</strong></td><td><span class="badge ${c.status === "paid" ? "badge-good" : "badge-low"}">${c.status === "paid" ? "Pago" : "Em aberto"}</span></td><td>${c.status === "open" ? `<button class="text-action" data-action="pay-credit" data-id="${c.id}">Receber</button>` : ""}</td></tr>`).join("") : `<tr><td colspan="8"><div class="empty-state">Nenhum fiado registrado nesta loja.</div></td></tr>`}</tbody></table></div></section>`;
}

function employeesPage() {
  return `${pageHeading("Acessos da loja", "Equipe", "Convide funcionários pelo e-mail e escolha o nível de acesso.", canManage() ? `<button class="button button-primary" data-action="invite-employee">＋ Convidar funcionário</button>` : "")}
    <div class="notice">O funcionário cria a própria conta e confirma o e-mail do convite. Nunca compartilhe sua senha.</div>
    <section class="panel"><div class="table-wrap"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Acesso</th><th>Status</th><th>Convite</th><th></th></tr></thead><tbody>${state.members.map((m) => `<tr><td><strong>${escapeHtml(m.full_name || "Convite enviado")}</strong></td><td>${escapeHtml(m.email)}</td><td>${m.role === "owner" ? "Proprietário" : m.role === "manager" ? "Gerente" : "Caixa"}</td><td><span class="badge ${m.status === "active" ? "badge-good" : "badge-out"}">${m.status === "active" ? "Ativo" : "Aguardando cadastro"}</span></td><td>${dateTime(m.created_at)}</td><td>${canManage() && m.role !== "owner" ? `<button class="text-action" data-action="remove-member" data-id="${m.id}">Remover</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="6"><div class="empty-state">Ainda não há funcionários nesta loja.</div></td></tr>`}</tbody></table></div></section>`;
}

function cashPage() {
  const register = state.register;
  const movements = register ? state.movements.filter((m) => m.cash_register_id === register.id) : [];
  const cashIn = movements.filter((m) => ["sale", "credit_payment", "entry"].includes(m.type)).reduce((sum, m) => sum + Number(m.amount), 0);
  const cashOut = movements.filter((m) => m.type === "withdrawal").reduce((sum, m) => sum + Number(m.amount), 0);
  const expected = Number(register?.opening_cash || 0) + cashIn - cashOut;
  return `${pageHeading("Controle de caixa", "Caixa da loja", register ? `Aberto desde ${dateTime(register.opened_at)} · fundo inicial ${money(register.opening_cash)}` : "Abra o caixa antes de registrar vendas.", register ? `<div class="toolbar">${canManage() ? `<button class="button button-secondary" data-action="cash-movement">＋ Entrada / retirada</button>` : ""}<button class="button button-danger" data-action="close-register">Fechar caixa</button></div>` : `<button class="button button-primary" data-action="open-register">＋ Abrir caixa</button>`)}
    ${register ? `<section class="report-grid"><article class="report-card"><label>Fundo inicial</label><strong>${money(register.opening_cash)}</strong><small>informado na abertura</small></article><article class="report-card"><label>Entradas no caixa</label><strong>${money(cashIn)}</strong><small>dinheiro, recebimentos e entradas</small></article><article class="report-card"><label>Saldo esperado</label><strong>${money(expected)}</strong><small>conferir antes do fechamento</small></article></section>
    <section class="panel section-spacer"><div class="panel-header"><div><h2 class="panel-title">Movimentações deste caixa</h2><p class="panel-note">${movements.length} registros · retiradas ${money(cashOut)}</p></div></div><div class="table-wrap"><table><thead><tr><th>Data</th><th>Movimentação</th><th>Detalhe</th><th>Valor</th></tr></thead><tbody>${movements.length ? [...movements].reverse().map((m) => `<tr><td>${dateTime(m.created_at)}</td><td>${movementLabel(m.type)}</td><td>${escapeHtml(m.description || "—")}</td><td><strong>${m.type === "withdrawal" ? "− " : "+ "}${money(m.amount)}</strong></td></tr>`).join("") : `<tr><td colspan="4"><div class="empty-state">As movimentações deste caixa aparecerão aqui.</div></td></tr>`}</tbody></table></div></section>` :
    `<section class="panel empty-state"><div style="font-size:32px">▣</div><h2>Seu caixa está fechado</h2><p>Abra o caixa para registrar vendas e controlar entradas e retiradas.</p><button class="button button-primary" data-action="open-register">Abrir caixa</button></section>`}
    <section class="panel section-spacer"><div class="panel-header"><div><h2 class="panel-title">Fechamentos anteriores</h2><p class="panel-note">Histórico de conferência do caixa</p></div></div><div class="table-wrap"><table><thead><tr><th>Abertura</th><th>Fechamento</th><th>Fundo</th><th>Saldo informado</th><th>Observação</th></tr></thead><tbody>${state.registers.filter((r) => r.status === "closed").slice(0, 15).map((r) => `<tr><td>${dateTime(r.opened_at)}</td><td>${dateTime(r.closed_at)}</td><td>${money(r.opening_cash)}</td><td>${money(r.closing_cash)}</td><td>${escapeHtml(r.closing_note || "—")}</td></tr>`).join("") || `<tr><td colspan="5"><div class="empty-state">Ainda não há fechamentos.</div></td></tr>`}</tbody></table></div></section>`;
}

function movementLabel(type) { return ({ sale: "Venda em dinheiro", credit_payment: "Recebimento de fiado", entry: "Entrada", withdrawal: "Retirada" })[type] || type; }

function reportsPage() {
  const sales = state.sales.filter((sale) => (!state.reportStart || sale.created_at >= `${state.reportStart}T00:00:00`) && (!state.reportEnd || sale.created_at <= `${state.reportEnd}T23:59:59`));
  const total = sales.reduce((sum, sale) => sum + Number(sale.total), 0);
  const units = sales.reduce((sum, sale) => sum + (sale.sale_items || []).reduce((n, item) => n + item.quantity, 0), 0);
  return `${pageHeading("Acompanhe seus resultados", "Relatórios de venda", "Consulte o movimento desta loja.", `<button class="button button-secondary" data-action="export-csv">↓ Exportar CSV</button>`)}
    <div class="report-filter"><label class="date-label">De <input id="report-start" type="date" value="${escapeHtml(state.reportStart)}" /></label><label class="date-label">Até <input id="report-end" type="date" value="${escapeHtml(state.reportEnd)}" /></label><button class="button button-secondary button-small" data-action="filter-reports">Aplicar</button></div>
    <section class="report-grid section-spacer"><article class="report-card"><label>Faturamento</label><strong>${money(total)}</strong><small>no período selecionado</small></article><article class="report-card"><label>Vendas concluídas</label><strong>${sales.length}</strong><small>pedidos registrados</small></article><article class="report-card"><label>Itens vendidos</label><strong>${units}</strong><small>unidades no período</small></article></section>
    <section class="panel"><div class="panel-header"><div><h2 class="panel-title">Histórico de vendas</h2><p class="panel-note">Inclui a forma de pagamento e cliente vinculado</p></div></div><div class="table-wrap"><table><thead><tr><th>Venda</th><th>Data</th><th>Cliente</th><th>Itens</th><th>Pagamento</th><th>Valor</th></tr></thead><tbody>${sales.length ? sales.map((s) => `<tr><td><strong>#${s.id.slice(0,8)}</strong></td><td>${dateTime(s.created_at)}</td><td>${escapeHtml(s.customers?.name || "Venda balcão")}</td><td>${(s.sale_items || []).reduce((n, item) => n + item.quantity, 0)}</td><td>${escapeHtml(s.payment_method)}</td><td><strong>${money(s.total)}</strong></td></tr>`).join("") : `<tr><td colspan="6"><div class="empty-state">Nenhuma venda neste período.</div></td></tr>`}</tbody></table></div></section>`;
}

function storePage() {
  const store = state.store;
  return `${pageHeading("Identidade do negócio", "Minha loja", "Atualize as informações e a foto que identificam seu negócio.", canManage() ? `<button class="button button-primary" form="store-form">Salvar alterações</button>` : "")}
    <section class="panel store-settings"><div class="store-logo-preview">${store.logo_url ? `<img src="${escapeHtml(store.logo_url)}" alt="Logo da loja" />` : `<span>${escapeHtml((store.name || "L").slice(0,1).toUpperCase())}</span>`}</div>
    <form id="store-form" class="modal-form"><label class="form-field"><span>Foto da loja (PNG, JPG ou WebP; até 3 MB)</span><input class="input" name="logo" type="file" accept="image/png,image/jpeg,image/webp" ${canManage() ? "" : "disabled"} /></label><label class="form-field"><span>Nome da loja</span><input class="input" name="name" required maxlength="100" value="${escapeHtml(store.name)}" ${canManage() ? "" : "disabled"} /></label><label class="form-field"><span>Telefone</span><input class="input" name="phone" type="tel" maxlength="30" value="${escapeHtml(store.phone || "")}" ${canManage() ? "" : "disabled"} /></label><div class="form-field"><span>Proprietário</span><input class="input" disabled value="${escapeHtml(state.members.find((m) => m.role === "owner")?.email || state.user.email)}" /></div></form>
    <div class="store-info"><strong>Os dados da loja ficam isolados por conta.</strong><p>Funcionários, vendas, clientes, caixa e produtos são compartilhados somente com os usuários autorizados nesta loja.</p></div></section>`;
}

function adminPage() {
  if (!isOwner()) return pageHeading("Acesso restrito", "Área administrativa", "Esta área é exclusiva do proprietário do sistema.");
  return `${pageHeading("Proprietário do sistema", "Lojas cadastradas", "Acesse os negócios de todos os clientes e cadastre lojas para contas já confirmadas.", `<button class="button button-primary" data-action="admin-new-store">＋ Cadastrar loja</button>`)}
    <div class="notice notice-warn">Para criar uma loja para outra pessoa, ela precisa primeiro criar uma conta e confirmar o e-mail. O acesso continua isolado por loja.</div>
    <section class="panel"><div class="table-wrap"><table><thead><tr><th>Loja</th><th>Proprietário</th><th>Telefone</th><th>Criada em</th><th></th></tr></thead><tbody>${state.stores.map((store) => { const owner = (store.store_members || []).find((m) => m.role === "owner"); return `<tr><td><span class="stock-name">${store.logo_url ? `<img class="tiny-logo" src="${escapeHtml(store.logo_url)}" alt="" />` : "🏪"}<strong>${escapeHtml(store.name)}</strong></span></td><td>${escapeHtml(owner?.email || "—")}</td><td>${escapeHtml(store.phone || "—")}</td><td>${new Date(store.created_at).toLocaleDateString("pt-BR")}</td><td><button class="text-action" data-action="select-store" data-id="${store.id}">Abrir</button></td></tr>`; }).join("")}</tbody></table></div></section>`;
}

function render() {
  if (!state.user) return authShell();
  document.querySelector(".topbar").hidden = false;
  const store = state.store;
  document.querySelector(".store-status").innerHTML = `<i></i>${state.register ? "Caixa aberto" : "Caixa fechado"}`;
  document.querySelector(".admin-nav").hidden = !isOwner();
  const switcher = document.querySelector("#store-switcher");
  switcher.innerHTML = state.stores.length > 1 ? state.stores.map((item) => `<option value="${item.id}" ${item.id === store?.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("") : "";
  switcher.hidden = state.stores.length < 2;
  document.querySelector("#alert-count").textContent = state.products.filter(lowStock).length || "";
  app.innerHTML = !store ? `<section class="panel empty-state"><h1>Nenhuma loja vinculada</h1><p>Crie sua loja para começar a usar o sistema.</p><button class="button button-primary" data-action="create-store">Criar loja</button></section>` :
    state.page === "sales" ? salesPage() :
    state.page === "products" ? productsPage() :
    state.page === "customers" ? customersPage() :
    state.page === "credits" ? creditsPage() :
    state.page === "employees" ? employeesPage() :
    state.page === "cash" ? cashPage() :
    state.page === "reports" ? reportsPage() :
    state.page === "store" ? storePage() :
    state.page === "admin" ? adminPage() : dashboardPage();
}

async function loadStore(storeId) {
  const selected = state.stores.find((item) => item.id === storeId);
  if (!selected) throw new Error("Você não tem acesso a essa loja.");
  state.store = selected;
  localStorage.setItem("cmd-selected-store", selected.id);
  const queries = await Promise.all([
    supabase.from("products").select("*").eq("store_id", selected.id).order("name"),
    supabase.from("customers").select("*").eq("store_id", selected.id).order("name"),
    supabase.from("sales").select("*, sale_items(*), customers(name)").eq("store_id", selected.id).order("created_at", { ascending: false }),
    supabase.from("store_members").select("*").eq("store_id", selected.id).order("created_at", { ascending: false }),
    supabase.from("credit_accounts").select("*, customers(name)").eq("store_id", selected.id).order("created_at", { ascending: false }),
    supabase.from("cash_registers").select("*").eq("store_id", selected.id).order("opened_at", { ascending: false }).limit(100),
    supabase.from("cash_movements").select("*").eq("store_id", selected.id).order("created_at", { ascending: true }).limit(500)
  ]);
  queries.forEach((result) => { if (result.error) throw result.error; });
  [state.products, state.customers, state.sales, state.members, state.credits, state.registers, state.movements] = queries.map((result) => result.data || []);
  state.register = state.registers.find((register) => register.status === "open") || null;
  render();
}

async function loadWorkspace(user) {
  state.user = user;
  const [profileResult, storesResult] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    supabase.from("stores").select("*, store_members(email, full_name, role)").order("created_at", { ascending: true })
  ]);
  if (profileResult.error) throw profileResult.error;
  if (storesResult.error) throw storesResult.error;
  state.profile = profileResult.data;
  state.stores = storesResult.data || [];
  if (!state.stores.length) {
    const name = user.user_metadata?.store_name || "Minha loja";
    const created = resultOrThrow(await supabase.rpc("create_store", { p_name: name }));
    const refreshed = resultOrThrow(await supabase.from("stores").select("*, store_members(email, full_name, role)").order("created_at"));
    state.stores = refreshed;
    return loadStore(created);
  }
  const savedId = localStorage.getItem("cmd-selected-store");
  const selected = state.stores.find((item) => item.id === savedId) || state.stores[0];
  return loadStore(selected.id);
}

async function refreshStore() { if (state.store) await loadStore(state.store.id); }

function openModal(content) {
  document.querySelector("#modal-root").innerHTML = `<div class="modal-backdrop" data-action="backdrop"><section class="modal" role="dialog" aria-modal="true">${content}</section></div>`;
}
function closeModal() { document.querySelector("#modal-root").innerHTML = ""; }
function modalHead(title, subtitle) {
  return `<div class="modal-head"><div><h2>${title}</h2><p>${subtitle}</p></div><button class="modal-close" data-action="close-modal" aria-label="Fechar">×</button></div>`;
}

function productForm(product = null) {
  if (!canManage()) return toast("Somente proprietário ou gerente pode editar produtos.", true);
  const p = product || { name:"", category:"Mercearia", code:"", price:"", cost:"", stock:"", min_stock:"5", emoji:"📦" };
  openModal(`${modalHead(product ? "Editar produto" : "Novo produto", "O estoque é compartilhado pelos funcionários autorizados desta loja.")}
    <form id="product-form" class="modal-form"><input type="hidden" name="id" value="${p.id || ""}" /><div class="form-grid">
    <label class="form-field full"><span>Nome do produto</span><input class="input" name="name" required maxlength="120" value="${escapeHtml(p.name)}" /></label>
    <label class="form-field"><span>Categoria</span><input class="input" name="category" required maxlength="40" value="${escapeHtml(p.category)}" /></label><label class="form-field"><span>Código / EAN</span><input class="input" name="code" maxlength="60" value="${escapeHtml(p.code || "")}" /></label>
    <label class="form-field"><span>Preço (R$)</span><input class="input" name="price" type="number" min=".01" step=".01" required value="${p.price}" /></label><label class="form-field"><span>Custo (R$)</span><input class="input" name="cost" type="number" min="0" step=".01" value="${p.cost || 0}" /></label>
    <label class="form-field"><span>Estoque</span><input class="input" name="stock" type="number" min="0" step="1" required value="${p.stock}" /></label><label class="form-field"><span>Estoque mínimo</span><input class="input" name="min_stock" type="number" min="0" step="1" value="${p.min_stock}" /></label>
    <label class="form-field"><span>Ícone</span><input class="input" name="emoji" maxlength="8" value="${escapeHtml(p.emoji || "📦")}" /></label></div><div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">Cancelar</button><button class="button button-primary">Salvar produto</button></div></form>`);
}

function restockForm(product) {
  openModal(`${modalHead("Repor estoque", `${escapeHtml(product.name)} · ${product.stock} unidades disponíveis`)}<form id="restock-form" class="modal-form"><input type="hidden" name="id" value="${product.id}" /><label class="form-field"><span>Quantidade a adicionar</span><input class="input" name="quantity" type="number" min="1" step="1" required /></label><div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">Cancelar</button><button class="button button-primary">Atualizar estoque</button></div></form>`);
}

function customerForm(customer = null) {
  const c = customer || { name:"", phone:"", email:"", notes:"", credit_limit:"" };
  openModal(`${modalHead(customer ? "Editar cliente" : "Novo cliente", "Os dados ficam disponíveis apenas para esta loja.")}<form id="customer-form" class="modal-form"><input type="hidden" name="id" value="${c.id || ""}" /><label class="form-field"><span>Nome completo</span><input class="input" name="name" required maxlength="120" value="${escapeHtml(c.name)}" /></label><div class="form-grid"><label class="form-field"><span>Telefone</span><input class="input" name="phone" type="tel" maxlength="30" value="${escapeHtml(c.phone || "")}" /></label><label class="form-field"><span>E-mail</span><input class="input" name="email" type="email" maxlength="254" value="${escapeHtml(c.email || "")}" /></label><label class="form-field"><span>Limite de fiado (opcional)</span><input class="input" name="credit_limit" type="number" min="0" step=".01" value="${c.credit_limit ?? ""}" placeholder="Sem limite" /></label><label class="form-field"><span>Observações</span><input class="input" name="notes" maxlength="200" value="${escapeHtml(c.notes || "")}" /></label></div><div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">Cancelar</button><button class="button button-primary">Salvar cliente</button></div></form>`);
}

function inviteForm() {
  openModal(`${modalHead("Convidar funcionário", "O convite é vinculado ao e-mail. O funcionário define a própria senha.")}<form id="invite-form" class="modal-form"><label class="form-field"><span>Nome</span><input class="input" name="full_name" required maxlength="120" /></label><label class="form-field"><span>E-mail de acesso</span><input class="input" name="email" type="email" required maxlength="254" /></label><label class="form-field"><span>Função</span><select class="select" name="role"><option value="cashier">Caixa · registrar vendas</option><option value="manager">Gerente · produtos e equipe</option></select></label><div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">Cancelar</button><button class="button button-primary">Enviar convite</button></div></form>`);
}

function openCashForm() {
  openModal(`${modalHead("Abrir caixa", "Informe o valor inicial em dinheiro da gaveta.")}<form id="open-cash-form" class="modal-form"><label class="form-field"><span>Fundo inicial (R$)</span><input class="input" name="opening_cash" type="number" min="0" step=".01" required value="0" /></label><label class="form-field"><span>Observação</span><input class="input" name="note" maxlength="160" /></label><div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">Cancelar</button><button class="button button-primary">Abrir caixa</button></div></form>`);
}

function closeCashForm() {
  const register = state.register;
  const movements = state.movements.filter((m) => m.cash_register_id === register.id);
  const expected = Number(register.opening_cash) + movements.filter((m) => ["sale","credit_payment","entry"].includes(m.type)).reduce((n,m)=>n+Number(m.amount),0) - movements.filter((m)=>m.type==="withdrawal").reduce((n,m)=>n+Number(m.amount),0);
  openModal(`${modalHead("Fechar caixa", `Saldo esperado ${money(expected)}. Informe o valor contado na gaveta.`)}<form id="close-cash-form" class="modal-form"><label class="form-field"><span>Valor contado (R$)</span><input class="input" name="closing_cash" type="number" min="0" step=".01" required value="${expected.toFixed(2)}" /></label><label class="form-field"><span>Observação</span><input class="input" name="note" maxlength="160" /></label><div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">Voltar</button><button class="button button-danger">Confirmar fechamento</button></div></form>`);
}

function movementForm() {
  openModal(`${modalHead("Entrada ou retirada", "Registre somente valores movimentados fora das vendas.")}<form id="movement-form" class="modal-form"><label class="form-field"><span>Tipo</span><select class="select" name="type"><option value="entry">Entrada</option><option value="withdrawal">Retirada</option></select></label><label class="form-field"><span>Valor (R$)</span><input class="input" name="amount" type="number" min=".01" step=".01" required /></label><label class="form-field"><span>Motivo</span><input class="input" name="description" required maxlength="160" /></label><div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">Cancelar</button><button class="button button-primary">Registrar movimentação</button></div></form>`);
}

function checkoutModal() {
  if (!state.register) return toast("Abra o caixa antes de finalizar a venda.", true);
  const opts = [["Pix","◇"],["Cartão","▣"],["Dinheiro","＄"],["Fiado","◷"]];
  openModal(`${modalHead("Finalizar venda", "Escolha o pagamento e confirme os dados.")}<form id="checkout-form" class="modal-form"><div class="report-card" style="text-align:center;margin-bottom:14px"><label>Total</label><strong id="checkout-total">${money(cartTotal())}</strong></div>
    <label class="form-field"><span>Forma de pagamento</span></label><div class="payment-options">${opts.map(([name,icon])=>`<button type="button" class="payment-option ${name==="Pix"?"active":""}" data-action="payment" data-value="${name}"><span>${icon}</span>${name}</button>`).join("")}</div>
    <label class="form-field" id="customer-field" hidden><span>Cliente do fiado</span><select class="select" name="customer_id"><option value="">Selecione um cliente</option>${state.customers.map((c)=>`<option value="${c.id}">${escapeHtml(c.name)}${c.phone?` · ${escapeHtml(c.phone)}`:""}</option>`).join("")}</select><button type="button" class="plain-link" data-action="quick-customer">＋ Cadastrar cliente</button></label>
    <label class="form-field" id="due-date-field" hidden><span>Vencimento do fiado</span><input class="input" name="due_date" type="date" min="${new Date().toISOString().slice(0,10)}" /></label>
    <label class="form-field" id="discount-field"><span>Desconto (R$), se houver</span><input class="input" name="discount" type="number" min="0" step=".01" value="0" /></label>
    <label class="form-field" id="cash-field" hidden><span>Valor recebido em dinheiro (R$)</span><input class="input" name="cash_received" type="number" min="${cartTotal()}" step=".01" /></label><div id="cash-change" class="activity-meta"></div>
    <div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">Voltar</button><button class="button button-primary">Confirmar venda</button></div></form>`);
  state.payment = "Pix";
}

function payCreditForm(credit) {
  const balance = Number(credit.amount_due) - Number(credit.amount_paid);
  openModal(`${modalHead("Receber fiado", `${escapeHtml(credit.customers?.name || "Cliente")} · saldo ${money(balance)}`)}<form id="pay-credit-form" class="modal-form"><input type="hidden" name="id" value="${credit.id}" /><label class="form-field"><span>Valor recebido (R$)</span><input class="input" name="amount" type="number" min=".01" max="${balance}" step=".01" required value="${balance.toFixed(2)}" /></label><label class="form-field"><span>Forma de pagamento</span><select class="select" name="payment_method"><option>Dinheiro</option><option>Pix</option><option>Cartão</option></select></label><div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">Cancelar</button><button class="button button-primary">Registrar recebimento</button></div></form>`);
}

function adminStoreForm() {
  openModal(`${modalHead("Cadastrar loja de cliente", "A conta do cliente deve existir e estar confirmada.")}<form id="admin-store-form" class="modal-form"><label class="form-field"><span>Nome da loja</span><input class="input" name="name" required maxlength="100" /></label><label class="form-field"><span>E-mail confirmado do proprietário</span><input class="input" name="email" type="email" required /></label><div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">Cancelar</button><button class="button button-primary">Criar loja</button></div></form>`);
}

async function mutate(task, successMessage) {
  try {
    await task();
    closeModal();
    await refreshStore();
    render();
    if (successMessage) toast(successMessage);
  } catch (error) { fail(error); }
}

async function saveProduct(form) {
  const data = new FormData(form);
  const id = data.get("id");
  const row = { store_id: state.store.id, name: String(data.get("name")).trim(), category: String(data.get("category")).trim(), code: String(data.get("code")).trim(), price: Number(data.get("price")), cost: Number(data.get("cost") || 0), stock: Number(data.get("stock")), min_stock: Number(data.get("min_stock") || 0), emoji: String(data.get("emoji") || "📦").trim() };
  if (!row.name || !row.category || row.price <= 0 || !Number.isInteger(row.stock) || row.stock < 0 || !Number.isInteger(row.min_stock) || row.min_stock < 0) throw new Error("Confira o preço e as quantidades informadas.");
  const result = id ? await supabase.from("products").update(row).eq("id", id).eq("store_id", state.store.id) : await supabase.from("products").insert(row);
  resultOrThrow(result);
  toast(id ? "Produto atualizado." : "Produto cadastrado.");
  closeModal();
  await refreshStore();
}

async function finishSale(form) {
  const data = new FormData(form);
  const payment = state.payment;
  const customer = String(data.get("customer_id") || "");
  const discount = Number(data.get("discount") || 0);
  if (payment === "Fiado" && !customer) throw new Error("Selecione um cliente para registrar o fiado.");
  const total = cartTotal();
  if (discount < 0 || discount > state.cart.reduce((sum, i) => sum + i.price * i.quantity, 0)) throw new Error("O desconto não pode ultrapassar o subtotal.");
  if (payment === "Dinheiro" && Number(data.get("cash_received") || 0) < total) throw new Error("O valor recebido em dinheiro não cobre o total.");
  const payload = {
    p_store_id: state.store.id, p_register_id: state.register.id,
    p_items: state.cart.map((item) => ({ product_id: item.id, quantity: item.quantity })),
    p_payment_method: payment, p_customer_id: customer || null, p_discount: discount,
    p_due_date: data.get("due_date") || null
  };
  const saleId = resultOrThrow(await supabase.rpc("complete_sale", payload));
  const change = payment === "Dinheiro" ? Number(data.get("cash_received")) - (total - discount) : 0;
  state.cart = [];
  state.discount = 0;
  closeModal();
  await refreshStore();
  render();
  toast(`Venda ${saleId.slice(0,8)} concluída.${change > 0 ? ` Troco: ${money(change)}.` : ""}`);
}

async function saveStore(form) {
  const data = new FormData(form);
  const name = String(data.get("name")).trim();
  const phone = String(data.get("phone")).trim();
  if (!name) throw new Error("Informe o nome da loja.");
  const file = data.get("logo");
  let logoUrl = state.store.logo_url;
  if (file instanceof File && file.size) {
    if (file.size > 3 * 1024 * 1024 || !["image/jpeg","image/png","image/webp"].includes(file.type)) throw new Error("Escolha um arquivo JPG, PNG ou WebP de até 3 MB.");
    const extension = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
    const path = `${state.store.id}/${crypto.randomUUID()}.${extension}`;
    const uploaded = await supabase.storage.from("store-logos").upload(path, file, { upsert: false, contentType: file.type });
    if (uploaded.error) throw uploaded.error;
    logoUrl = supabase.storage.from("store-logos").getPublicUrl(path).data.publicUrl;
  }
  const saved = await supabase.from("stores").update({ name, phone, logo_url: logoUrl, updated_at: new Date().toISOString() }).eq("id", state.store.id);
  resultOrThrow(saved);
  closeModal();
  await loadWorkspace(state.user);
  toast("Dados da loja atualizados.");
}

function exportCsv(sales) {
  const rows = [["Venda","Data","Cliente","Pagamento","Produto","Quantidade","Preço unitário","Total"]];
  sales.forEach((sale) => (sale.sale_items || []).forEach((item) => rows.push([sale.id, dateTime(sale.created_at), sale.customers?.name || "", sale.payment_method, item.product_name, item.quantity, item.unit_price, item.line_total])));
  const safe = (field) => {
    let text = String(field ?? "");
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"','""')}"`;
  };
  const blob = new Blob([`\uFEFF${rows.map((row) => row.map(safe).join(";")).join("\r\n")}`], { type:"text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `vendas-${state.store.name.toLowerCase().replace(/[^a-z0-9]+/g,"-")}-${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function setPage(page) {
  state.page = page;
  state.query = "";
  state.cart = page === "sales" ? state.cart : state.cart;
  render();
  window.scrollTo({ top:0, behavior:"smooth" });
}

document.addEventListener("click", async (event) => {
  const nav = event.target.closest("[data-page]");
  if (nav) {
    event.preventDefault();
    if (nav.dataset.page === "admin" && !isOwner()) return toast("Esta área é restrita.", true);
    setPage(nav.dataset.page);
    return;
  }
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, id, value } = button.dataset;
  try {
    if (action === "auth-signup") { authView = "signup"; render(); }
    else if (action === "auth-login") { authView = "login"; render(); }
    else if (action === "forgot-password") {
      const email = document.querySelector('#auth-form [name="email"]')?.value;
      if (!email) return toast("Informe seu e-mail no campo acima.", true);
      const result = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
      if (result.error) throw result.error;
      toast("Se a conta existir, você receberá um link para redefinir a senha.");
    } else if (action === "new-product") productForm();
    else if (action === "edit-product") productForm(state.products.find((p) => p.id === id));
    else if (action === "restock") restockForm(state.products.find((p) => p.id === id));
    else if (action === "delete-product") {
      const product = state.products.find((p) => p.id === id);
      if (window.confirm(`Excluir "${product.name}"? Vendas anteriores manterão o nome e o valor registrados.`)) {
        resultOrThrow(await supabase.from("products").delete().eq("id", id).eq("store_id", state.store.id));
        await refreshStore(); toast("Produto excluído.");
      }
    } else if (action === "new-customer") customerForm();
    else if (action === "edit-customer") customerForm(state.customers.find((c) => c.id === id));
    else if (action === "invite-employee") inviteForm();
    else if (action === "remove-member") {
      const member = state.members.find((m) => m.id === id);
      if (window.confirm(`Remover o acesso de ${member.email} a esta loja?`)) {
        resultOrThrow(await supabase.from("store_members").delete().eq("id", id).eq("store_id", state.store.id));
        await refreshStore(); toast("Acesso removido desta loja.");
      }
    } else if (action === "category") { state.category = value; render(); }
    else if (action === "add-cart") {
      const p = state.products.find((item) => item.id === id);
      const item = state.cart.find((entry) => entry.id === id);
      if (!p || p.stock <= 0) return toast("Produto sem estoque disponível.", true);
      if (item && item.quantity >= p.stock) return toast("Quantidade maior que o estoque disponível.", true);
      if (item) item.quantity++;
      else state.cart.push({ id:p.id, name:p.name, price:Number(p.price), quantity:1 });
      render();
    } else if (action === "cart-minus" || action === "cart-plus") {
      const item = state.cart.find((entry) => entry.id === id);
      if (!item) return;
      const p = state.products.find((entry) => entry.id === id);
      const next = item.quantity + (action === "cart-plus" ? 1 : -1);
      if (next > p.stock) return toast("Quantidade maior que o estoque disponível.", true);
      if (next < 1) state.cart = state.cart.filter((entry) => entry.id !== id);
      else item.quantity = next;
      render();
    } else if (action === "clear-cart") { state.cart = []; render(); }
    else if (action === "checkout") checkoutModal();
    else if (action === "payment") {
      state.payment = value;
      document.querySelectorAll(".payment-option").forEach((item) => item.classList.toggle("active", item.dataset.value === value));
      document.querySelector("#customer-field").hidden = value !== "Fiado";
      document.querySelector("#due-date-field").hidden = value !== "Fiado";
      document.querySelector("#cash-field").hidden = value !== "Dinheiro";
    } else if (action === "quick-customer") { closeModal(); customerForm(); }
    else if (action === "pay-credit") payCreditForm(state.credits.find((c) => c.id === id));
    else if (action === "open-register") openCashForm();
    else if (action === "close-register") closeCashForm();
    else if (action === "cash-movement") movementForm();
    else if (action === "filter-reports") {
      state.reportStart = document.querySelector("#report-start").value;
      state.reportEnd = document.querySelector("#report-end").value;
      render();
    } else if (action === "export-csv") {
      const sales = state.sales.filter((s) => (!state.reportStart || s.created_at >= `${state.reportStart}T00:00:00`) && (!state.reportEnd || s.created_at <= `${state.reportEnd}T23:59:59`));
      exportCsv(sales);
    } else if (action === "admin-new-store") adminStoreForm();
    else if (action === "select-store") { await loadStore(id); state.page = "dashboard"; render(); }
    else if (action === "create-store") {
      const name = window.prompt("Nome da nova loja:");
      if (name?.trim()) {
        const created = resultOrThrow(await supabase.rpc("create_store", { p_name:name.trim() }));
        state.stores = resultOrThrow(await supabase.from("stores").select("*, store_members(email, full_name, role)").order("created_at"));
        await loadStore(created); state.page = "store"; render();
      }
    } else if (action === "close-modal" || (action === "backdrop" && event.target === button)) closeModal();
  } catch (error) { fail(error); }
});

document.addEventListener("input", (event) => {
  if (event.target.id === "search") {
    const cursor = event.target.selectionStart;
    state.query = event.target.value;
    render();
    const input = document.querySelector("#search");
    input?.focus();
    input?.setSelectionRange(cursor, cursor);
  }
  if (event.target.name === "discount") {
    const subtotal = state.cart.reduce((sum,item)=>sum+item.price*item.quantity,0);
    state.discount = Math.max(0, Number(event.target.value || 0));
    const total = Math.max(0, subtotal - state.discount);
    document.querySelector("#checkout-total").textContent = money(total);
    const cash = document.querySelector('[name="cash_received"]');
    if (cash) cash.min = total;
  }
  if (event.target.name === "cash_received") {
    const total = Math.max(0, state.cart.reduce((sum,item)=>sum+item.price*item.quantity,0) - state.discount);
    const change = Number(event.target.value || 0) - total;
    document.querySelector("#cash-change").textContent = change >= 0 ? `Troco: ${money(change)}` : `Faltam ${money(-change)}`;
  }
});

document.addEventListener("change", async (event) => {
  if (event.target.id === "store-switcher" && event.target.value) {
    try { await loadStore(event.target.value); state.page = "dashboard"; render(); }
    catch (error) { fail(error); }
  }
});

document.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  try {
    if (form.id === "config-form") {
      const data = new FormData(form);
      const url = String(data.get("url")).trim().replace(/\/+$/, "");
      const anonKey = String(data.get("anonKey")).trim();
      if (!url.startsWith("https://") || !anonKey) throw new Error("Informe a URL HTTPS e a chave pública do projeto.");
      localStorage.setItem("cmd-supabase-config", JSON.stringify({ url, anonKey }));
      supabase = createClient(url, anonKey);
      authView = "login";
      render();
      toast("Conexão configurada. Agora entre ou crie sua conta.");
    } else if (form.id === "auth-form") {
      const data = new FormData(form);
      const email = String(data.get("email")).trim().toLowerCase();
      const password = String(data.get("password"));
      if (authView === "signup") {
        const result = await supabase.auth.signUp({ email, password, options: { data: { full_name:String(data.get("fullName")).trim(), store_name:String(data.get("storeName")).trim() }, emailRedirectTo:window.location.origin } });
        if (result.error) throw result.error;
        if (result.data.session) {
          await loadWorkspace(result.data.user);
          toast("Conta e loja criadas.");
        } else {
          toast("Conta criada. Confirme o e-mail enviado antes de entrar.");
          authView = "login"; render();
        }
      } else {
        const result = await supabase.auth.signInWithPassword({ email, password });
        if (result.error) throw result.error;
        await loadWorkspace(result.data.user);
      }
    } else if (form.id === "product-form") await saveProduct(form);
    else if (form.id === "restock-form") {
      const data = new FormData(form);
      const product = state.products.find((p) => p.id === data.get("id"));
      const quantity = Number(data.get("quantity"));
      if (!product || !Number.isInteger(quantity) || quantity < 1) throw new Error("Informe uma quantidade inteira maior que zero.");
      resultOrThrow(await supabase.from("products").update({ stock:product.stock + quantity, updated_at:new Date().toISOString() }).eq("id",product.id).eq("store_id",state.store.id));
      closeModal(); await refreshStore(); toast("Estoque atualizado.");
    } else if (form.id === "customer-form") {
      const data = new FormData(form);
      const id = String(data.get("id") || "");
      const credit = String(data.get("credit_limit") || "");
      const row = { store_id:state.store.id, name:String(data.get("name")).trim(), phone:String(data.get("phone")).trim(), email:String(data.get("email")).trim(), notes:String(data.get("notes")).trim(), credit_limit:credit === "" ? null : Number(credit) };
      if (!row.name || (row.credit_limit != null && row.credit_limit < 0)) throw new Error("Confira o nome e o limite de fiado.");
      const result = id ? await supabase.from("customers").update(row).eq("id",id).eq("store_id",state.store.id) : await supabase.from("customers").insert(row);
      resultOrThrow(result); closeModal(); await refreshStore(); toast(id ? "Cliente atualizado." : "Cliente cadastrado.");
    } else if (form.id === "invite-form") {
      const data = new FormData(form);
      resultOrThrow(await supabase.rpc("invite_employee", { p_store_id:state.store.id, p_full_name:String(data.get("full_name")).trim(), p_email:String(data.get("email")).trim().toLowerCase(), p_role:data.get("role") }));
      closeModal(); await refreshStore(); toast("Convite registrado. O funcionário deve criar uma conta com esse e-mail.");
    } else if (form.id === "open-cash-form") {
      const data = new FormData(form);
      const id = resultOrThrow(await supabase.rpc("open_cash_register", { p_store_id:state.store.id, p_opening_cash:Number(data.get("opening_cash")), p_note:String(data.get("note") || "") }));
      closeModal(); await refreshStore(); toast(`Caixa aberto · ${id.slice(0,8)}.`);
    } else if (form.id === "close-cash-form") {
      const data = new FormData(form);
      resultOrThrow(await supabase.rpc("close_cash_register", { p_register_id:state.register.id, p_closing_cash:Number(data.get("closing_cash")), p_note:String(data.get("note") || "") }));
      closeModal(); await refreshStore(); toast("Caixa fechado e saldo registrado.");
    } else if (form.id === "movement-form") {
      const data = new FormData(form);
      resultOrThrow(await supabase.rpc("add_cash_movement", { p_register_id:state.register.id, p_type:data.get("type"), p_amount:Number(data.get("amount")), p_description:String(data.get("description")).trim() }));
      closeModal(); await refreshStore(); toast("Movimentação registrada.");
    } else if (form.id === "checkout-form") await finishSale(form);
    else if (form.id === "pay-credit-form") {
      const data = new FormData(form);
      resultOrThrow(await supabase.rpc("pay_credit", { p_credit_id:data.get("id"), p_register_id:state.register?.id, p_amount:Number(data.get("amount")), p_payment_method:data.get("payment_method") }));
      closeModal(); await refreshStore(); toast("Recebimento de fiado registrado.");
    } else if (form.id === "store-form") await saveStore(form);
    else if (form.id === "admin-store-form") {
      const data = new FormData(form);
      resultOrThrow(await supabase.rpc("admin_create_store", { p_name:String(data.get("name")).trim(), p_owner_email:String(data.get("email")).trim().toLowerCase() }));
      const stores = resultOrThrow(await supabase.from("stores").select("*, store_members(email, full_name, role)").order("created_at"));
      state.stores = stores; closeModal(); render(); toast("Loja vinculada à conta confirmada.");
    }
  } catch (error) { fail(error); }
});

document.querySelector("#sign-out").addEventListener("click", async () => {
  try {
    const result = await supabase.auth.signOut();
    if (result.error) throw result.error;
    state = { ...state, user:null, profile:null, stores:[], store:null, products:[], sales:[], customers:[], members:[], credits:[], registers:[], movements:[], register:null, cart:[] };
    render();
  } catch (error) { fail(error); }
});

async function boot() {
  try {
    const saved = JSON.parse(localStorage.getItem("cmd-supabase-config") || "null");
    const config = saved || window.CMD_SUPABASE_CONFIG;
    if (config?.url && config?.anonKey) supabase = createClient(config.url, config.anonKey);
    render();
    if (!supabase) return;
    const sessionResult = await supabase.auth.getSession();
    if (sessionResult.error) throw sessionResult.error;
    if (sessionResult.data.session?.user) {
      app.innerHTML = `<div class="loading-state">Carregando os dados seguros da loja…</div>`;
      try { await loadWorkspace(sessionResult.data.session.user); }
      catch (error) { fail(error); }
    }
    supabase.auth.onAuthStateChange((event, session) => {
      window.setTimeout(async () => {
        if (event === "SIGNED_OUT") {
          state.user = null; state.profile = null; state.store = null; render();
        } else if (session?.user && state.user?.id !== session.user.id) {
          try { await loadWorkspace(session.user); }
          catch (error) { fail(error); }
        }
      }, 0);
    });
  } catch (error) {
    fail(error, "Não foi possível conectar ao Supabase.");
    if (!supabase) authShell();
  }
}

document.addEventListener("click", (event) => {
  if (event.target.matches('[data-action="auth-signup"],[data-action="auth-login"],[data-action="forgot-password"]')) return;
  if (event.target.closest('[data-action="auth-signup"],[data-action="auth-login"],[data-action="forgot-password"]')) return;
  if (event.key === "Escape") closeModal();
});

window.addEventListener("keydown", (event) => { if (event.key === "Escape") closeModal(); });

boot();
