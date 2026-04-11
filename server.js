const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const XROCKET_API_KEY = process.env.XROCKET_API_KEY;
const BACKEND_URL = process.env.BACKEND_URL || 'https://digimarket-h0vk.onrender.com';
const FRONTEND_URL = 'https://orlandojaime833-ux.github.io/DIGIMARKET-';
const ADMIN_EMAILS = ['orlandojaime833@gmail.com', 'orlandojaime800@gmail.com'];
const XROCKET_BASE = 'https://pay.ton-rocket.com';
const TAXA_REDE = 0.01;
const COMISSAO_PLANO = 0.20;
const COMISSAO_LOJA  = 0.10;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const PLANOS = {
  standard: { usd:9, nome:'Standard' },
  pro:      { usd:25, nome:'Pro' },
  business: { usd:60, nome:'Business' },
};
const LIMITES = {
  free:{prods:5,imgs:1}, standard:{prods:30,imgs:3},
  pro:{prods:100,imgs:5}, business:{prods:9999,imgs:10}
};

// ── Helpers ──────────────────────────────────────────────────────────
async function authUser(req) {
  const token = req.headers.authorization?.replace('Bearer ','');
  if (!token) return null;
  const { data:{ user }, error } = await supabase.auth.getUser(token);
  return (error || !user) ? null : user;
}
async function requireAdmin(req, res) {
  const user = await authUser(req);
  if (!user || !ADMIN_EMAILS.includes(user.email)) {
    res.status(403).json({ error:'Acesso negado' }); return null;
  }
  return user;
}
async function getTonRate() {
  try {
    const r = await axios.get('https://trade.ton-rocket.com/rates/crypto-fiat?crypto=TONCOIN&fiat=USD',
      { headers:{ 'Rocket-Pay-Key': XROCKET_API_KEY } });
    return parseFloat(r.data?.data?.rate || 5);
  } catch { return 5; }
}
async function getConfig() {
  const { data } = await supabase.from('config_plataforma').select('*').eq('id',1).single();
  return data || {};
}

// ════════════════════════════════════════════════════════
// LINKS MASCARADOS  /r/:codigo
// ════════════════════════════════════════════════════════
app.get('/r/:codigo', async (req, res) => {
  const { codigo } = req.params;
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').substring(0,45);
  const ua = (req.headers['user-agent'] || '').substring(0,200);
  const ref = (req.headers.referer || '').substring(0,300);
  try {
    const { data:af } = await supabase.from('afiliados')
      .select('id,codigo,destino,ativo').eq('codigo',codigo).single();
    if (!af || !af.ativo) return res.redirect(FRONTEND_URL);
    await supabase.from('afiliado_cliques').insert({ afiliado_id:af.id, ip, user_agent:ua, referer:ref });
    await supabase.rpc('incrementar_cliques', { afiliado_id: af.id });
    const dest = af.destino || FRONTEND_URL;
    const sep = dest.includes('?') ? '&' : '?';
    res.setHeader('Set-Cookie',`digi_ref=${codigo}; Path=/; Max-Age=2592000; SameSite=None; Secure`);
    res.redirect(`${dest}${sep}ref=${codigo}`);
  } catch(e) {
    console.error('Redirect erro:',e.message);
    res.redirect(FRONTEND_URL);
  }
});

// ════════════════════════════════════════════════════════
// AFILIADOS
// ════════════════════════════════════════════════════════
app.post('/api/afiliado/registar', async (req, res) => {
  const user = await authUser(req);
  if (!user) return res.status(401).json({ error:'Não autenticado' });
  const { data:ex } = await supabase.from('afiliados').select('id,codigo').eq('user_id',user.id).single();
  if (ex) return res.json({ success:true, already:true, link:`${BACKEND_URL}/r/${ex.codigo}` });
  const { carteira_ton, nome } = req.body;
  const codigo = Math.random().toString(36).substring(2,10).toUpperCase();
  const { data, error } = await supabase.from('afiliados').insert({
    user_id:user.id, email:user.email,
    nome: nome || user.email.split('@')[0],
    codigo, carteira_ton: carteira_ton||null,
    destino: FRONTEND_URL, ativo:true,
  }).select().single();
  if (error) return res.status(500).json({ error:error.message });
  res.json({ success:true, afiliado:data, link:`${BACKEND_URL}/r/${codigo}` });
});

app.get('/api/afiliado/me', async (req, res) => {
  const user = await authUser(req);
  if (!user) return res.status(401).json({ error:'Não autenticado' });
  const { data:af } = await supabase.from('afiliados').select('*').eq('user_id',user.id).single();
  if (!af) return res.status(404).json({ error:'Não és afiliado' });
  const { count:cliques } = await supabase.from('afiliado_cliques')
    .select('*',{count:'exact',head:true}).eq('afiliado_id',af.id);
  const { data:comissoes } = await supabase.from('afiliado_comissoes')
    .select('*').eq('afiliado_id',af.id).order('criado_em',{ascending:false});
  const { data:saques } = await supabase.from('afiliado_saques')
    .select('*').eq('afiliado_id',af.id).order('criado_em',{ascending:false});
  const { data:lojas } = await supabase.from('afiliado_lojas')
    .select('*, lojistas(nome_loja,slug)').eq('afiliado_id',af.id).eq('ativo',true);
  const { data:cliquesRecentes } = await supabase.from('afiliado_cliques')
    .select('criado_em').eq('afiliado_id',af.id)
    .gte('criado_em', new Date(Date.now()-30*86400000).toISOString());
  res.json({
    success:true, afiliado:af,
    link:`${BACKEND_URL}/r/${af.codigo}`,
    stats:{
      cliques: cliques||0,
      conversoes: comissoes?.filter(c=>c.tipo==='plano').length||0,
      lojas_afiliadas: lojas?.length||0,
      saldo_disponivel: parseFloat((af.saldo_disponivel||0).toFixed(6)),
      saldo_pago: parseFloat((af.saldo_pago||0).toFixed(6)),
      total_ganho: parseFloat((comissoes||[]).reduce((a,c)=>a+c.valor_ton,0).toFixed(6)),
    },
    comissoes: comissoes||[], saques: saques||[],
    lojas: lojas||[], cliques_recentes: cliquesRecentes||[],
  });
});

app.put('/api/afiliado/perfil', async (req, res) => {
  const user = await authUser(req);
  if (!user) return res.status(401).json({ error:'Não autenticado' });
  const { error } = await supabase.from('afiliados')
    .update({ carteira_ton:req.body.carteira_ton, nome:req.body.nome }).eq('user_id',user.id);
  if (error) return res.status(500).json({ error:error.message });
  res.json({ success:true });
});

app.post('/api/afiliado/link', async (req, res) => {
  const user = await authUser(req);
  if (!user) return res.status(401).json({ error:'Não autenticado' });
  const { destino_tipo, slug } = req.body;
  const { data:af } = await supabase.from('afiliados').select('id,codigo').eq('user_id',user.id).single();
  if (!af) return res.status(404).json({ error:'Não és afiliado' });
  const destino = slug ? `${FRONTEND_URL}/s/${slug}` : FRONTEND_URL;
  await supabase.from('afiliado_links').upsert({
    afiliado_id:af.id, codigo:af.codigo,
    destino, destino_tipo: destino_tipo||'plataforma',
  },{ onConflict:'afiliado_id,destino_tipo' });
  await supabase.from('afiliados').update({ destino }).eq('id',af.id);
  res.json({ success:true, link:`${BACKEND_URL}/r/${af.codigo}`, destino });
});

app.post('/api/afiliado/loja/associar', async (req, res) => {
  const user = await authUser(req);
  if (!user) return res.status(401).json({ error:'Não autenticado' });
  const { data:af } = await supabase.from('afiliados').select('id,codigo').eq('user_id',user.id).single();
  if (!af) return res.status(404).json({ error:'Não és afiliado' });
  const { data:loja } = await supabase.from('lojistas').select('id,nome_loja').eq('slug',req.body.slug_loja).single();
  if (!loja) return res.status(404).json({ error:'Loja não encontrada' });
  await supabase.from('afiliado_lojas').upsert({ afiliado_id:af.id, lojista_id:loja.id, ativo:true },{onConflict:'afiliado_id,lojista_id'});
  res.json({ success:true, loja:loja.nome_loja, link:`${BACKEND_URL}/r/${af.codigo}` });
});

// ── Saque ────────────────────────────────────────────────────────────
app.post('/api/afiliado/saque', async (req, res) => {
  const user = await authUser(req);
  if (!user) return res.status(401).json({ error:'Não autenticado' });
  const { carteira_destino, metodo } = req.body;
  if (!carteira_destino) return res.status(400).json({ error:'Carteira obrigatória' });
  const { data:af } = await supabase.from('afiliados').select('*').eq('user_id',user.id).single();
  if (!af) return res.status(404).json({ error:'Afiliado não encontrado' });
  const saldo = parseFloat(af.saldo_disponivel||0);
  if (saldo<=0) return res.status(400).json({ error:'Saldo insuficiente' });
  const { count:conv } = await supabase.from('afiliado_comissoes')
    .select('*',{count:'exact',head:true})
    .eq('afiliado_id',af.id).eq('tipo','plano').in('status',['disponivel','pago']);
  if (!conv||conv===0) return res.status(400).json({ error:'Precisas de pelo menos 1 cliente convertido para sacar' });
  const liquido = parseFloat((saldo - TAXA_REDE).toFixed(8));
  if (liquido<=0) return res.status(400).json({ error:`Saldo insuficiente para taxa de rede (${TAXA_REDE} TON)` });
  try {
    const { data:saque, error:seErr } = await supabase.from('afiliado_saques').insert({
      afiliado_id:af.id, valor_ton:saldo, carteira_destino,
      metodo:metodo||'ton', taxa_rede:TAXA_REDE, valor_liquido:liquido, status:'processando',
    }).select().single();
    if (seErr) throw seErr;
    let txHash = null;
    try {
      const xRes = await axios.post(`${XROCKET_BASE}/withdrawal`,{
        network:'TON', currency:'TONCOIN', amount:liquido,
        address:carteira_destino, comment:`DIGIMarket Afiliado #${af.codigo}`,
      },{ headers:{'Rocket-Pay-Key':XROCKET_API_KEY,'Content-Type':'application/json'} });
      txHash = xRes.data?.data?.txHash||null;
    } catch(xErr) {
      await supabase.from('afiliado_saques').update({ status:'pendente' }).eq('id',saque.id);
      return res.json({ success:true, manual:true, message:'Saque registado. Processado pelo administrador em até 24h.', saque_id:saque.id });
    }
    await supabase.from('afiliado_saques').update({ status:'pago', tx_hash:txHash, processado_em:new Date().toISOString() }).eq('id',saque.id);
    await supabase.from('afiliados').update({ saldo_disponivel:0, saldo_pago:parseFloat((af.saldo_pago||0)+saldo).toFixed(8) }).eq('id',af.id);
    await supabase.from('afiliado_comissoes').update({ status:'pago', pago_em:new Date().toISOString() }).eq('afiliado_id',af.id).eq('status','disponivel');
    res.json({ success:true, tx_hash:txHash, valor_liquido:liquido, taxa:TAXA_REDE });
  } catch(e) {
    res.status(500).json({ error:e.message });
  }
});

// ════════════════════════════════════════════════════════
// PAGAMENTOS / INVOICES
// ════════════════════════════════════════════════════════
app.get('/api/currencies', async (req, res) => {
  try {
    const r = await axios.get(`${XROCKET_BASE}/currencies`,{ headers:{'Rocket-Pay-Key':XROCKET_API_KEY} });
    res.json({ success:true, currencies:(r.data?.data?.results||[]).filter(c=>c.available) });
  } catch {
    res.json({ success:true, currencies:[
      {currency:'TONCOIN',name:'Toncoin'},{currency:'USDT',name:'Tether USD'},
      {currency:'NOT',name:'Notcoin'},{currency:'DOGS',name:'DOGS'},{currency:'BOLT',name:'Bolt'},
    ]});
  }
});

app.get('/api/rate/:currency', async (req, res) => {
  try {
    const r = await axios.get(`https://trade.ton-rocket.com/rates/crypto-fiat?crypto=${req.params.currency}&fiat=USD`,{ headers:{'Rocket-Pay-Key':XROCKET_API_KEY} });
    const rate = parseFloat(r.data?.data?.rate||0);
    if (rate>0) return res.json({ success:true, currency:req.params.currency, usd_per_unit:rate });
    throw new Error('zero');
  } catch {
    const fb={TONCOIN:5,USDT:1,NOT:0.008,DOGS:0.0005,BOLT:0.05};
    res.json({ success:true, currency:req.params.currency, usd_per_unit:fb[req.params.currency]||1 });
  }
});

app.post('/api/invoice/create', async (req, res) => {
  const user = await authUser(req);
  if (!user) return res.status(401).json({ error:'Não autenticado' });
  const { plano, currency, ref_codigo } = req.body;
  if (!PLANOS[plano]) return res.status(400).json({ error:'Plano inválido' });
  try {
    const usd = PLANOS[plano].usd;
    const rateRes = await axios.get(`https://trade.ton-rocket.com/rates/crypto-fiat?crypto=${currency}&fiat=USD`,{ headers:{'Rocket-Pay-Key':XROCKET_API_KEY} }).catch(()=>null);
    const fb={TONCOIN:5,USDT:1,NOT:0.008,DOGS:0.0005,BOLT:0.05};
    const rate = parseFloat(rateRes?.data?.data?.rate||fb[currency]||1);
    const amount = parseFloat((usd/rate).toFixed(6));
    const xRes = await axios.post(`${XROCKET_BASE}/tg-invoices`,{
      amount, currency,
      description:`DIGIMarket — Plano ${PLANOS[plano].nome} (1 mês)`,
      hiddenMessage:`Plano ${plano} activado! Bem-vindo à DIGIMarket.`,
      payload: JSON.stringify({ userId:user.id, plano, currency, ref_codigo:ref_codigo||null }),
      callbackUrl:`${BACKEND_URL}/api/webhook/xrocket`,
    },{ headers:{'Rocket-Pay-Key':XROCKET_API_KEY,'Content-Type':'application/json'} });
    const invoice = xRes.data?.data;
    if (!invoice) throw new Error('Invoice não criada');
    await supabase.from('pagamentos').insert({
      lojista_id:user.id, plano, valor_crypto:amount, currency, valor_usd:usd,
      invoice_id:String(invoice.id), invoice_link:invoice.link, status:'pending',
    });
    res.json({ success:true, invoice_id:invoice.id, invoice_link:invoice.link, amount, currency });
  } catch(e) { res.status(500).json({ error:e.response?.data?.message||e.message }); }
});

app.get('/api/invoice/:id/status', async (req, res) => {
  const user = await authUser(req);
  if (!user) return res.status(401).json({ error:'Não autenticado' });
  try {
    const xRes = await axios.get(`${XROCKET_BASE}/tg-invoices/${req.params.id}`,{ headers:{'Rocket-Pay-Key':XROCKET_API_KEY} });
    const invoice = xRes.data?.data;
    const paid = invoice?.status==='paid';
    if (paid) await activarPlano(user.id, req.params.id, null);
    res.json({ success:true, status:invoice?.status||'pending', paid });
  } catch { res.status(500).json({ error:'Erro ao verificar' }); }
});

app.post('/api/webhook/xrocket', async (req, res) => {
  try {
    const data = req.body;
    if (data?.type==='invoicePaid'||data?.status==='paid') {
      const payload = JSON.parse(data?.payload||data?.data?.payload||'{}');
      const invoiceId = String(data?.id||data?.data?.id);
      if (payload.userId&&payload.plano) await activarPlano(payload.userId, invoiceId, payload.ref_codigo);
    }
    res.json({ success:true });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

async function activarPlano(userId, invoiceId, refCodigo) {
  const expira = new Date(); expira.setMonth(expira.getMonth()+1);
  const { data:pag } = await supabase.from('pagamentos').select('*').eq('invoice_id',invoiceId).eq('lojista_id',userId).single();
  if (!pag||pag.status==='confirmed') return;
  await supabase.from('pagamentos').update({ status:'confirmed', confirmado_em:new Date().toISOString() }).eq('invoice_id',invoiceId);
  const { data:lj } = await supabase.from('lojistas').select('slug').eq('id',userId).single();
  const slug = lj?.slug || 'loja-'+userId.substring(0,8);
  await supabase.from('lojistas').update({ slug, plano:pag.plano, plano_expira_em:expira.toISOString(), status:'active' }).eq('id',userId);
  if (refCodigo) await processarComissaoPlano(refCodigo, invoiceId, pag.plano, pag.valor_usd);
}

async function processarComissaoPlano(refCodigo, invoiceId, plano, valorUsd) {
  try {
    const { data:af } = await supabase.from('afiliados').select('*').eq('codigo',refCodigo).eq('ativo',true).single();
    if (!af) return;
    const { data:ex } = await supabase.from('afiliado_comissoes').select('id').eq('referencia_id',invoiceId).single();
    if (ex) return;
    const tonRate = await getTonRate();
    const comUsd = parseFloat((valorUsd*COMISSAO_PLANO).toFixed(2));
    const comTon = parseFloat((comUsd/tonRate).toFixed(8));
    await supabase.from('afiliado_comissoes').insert({
      afiliado_id:af.id, tipo:'plano',
      descricao:`20% comissão — Plano ${plano} activado`,
      referencia_id:invoiceId, valor_usd:comUsd, percentagem:20,
      valor_ton:comTon, currency:'TONCOIN', status:'disponivel',
    });
    await supabase.from('afiliados').update({
      saldo_disponivel: parseFloat(((af.saldo_disponivel||0)+comTon).toFixed(8)),
      total_conversoes: (af.total_conversoes||0)+1,
    }).eq('id',af.id);
  } catch(e) { console.error('Comissão plano erro:',e.message); }
}

app.post('/api/afiliado/comissao/loja', async (req, res) => {
  const { lojista_id, valor_compra_usd, referencia_id } = req.body;
  if (!lojista_id||!valor_compra_usd) return res.status(400).json({ error:'Dados insuficientes' });
  try {
    const { data:assoc } = await supabase.from('afiliado_lojas')
      .select('afiliado_id, afiliados(saldo_disponivel)').eq('lojista_id',lojista_id).eq('ativo',true).single();
    if (!assoc) return res.json({ success:true, message:'Sem afiliado directo' });
    const tonRate = await getTonRate();
    const comUsd = parseFloat((valor_compra_usd*COMISSAO_LOJA).toFixed(2));
    const comTon = parseFloat((comUsd/tonRate).toFixed(8));
    await supabase.from('afiliado_comissoes').insert({
      afiliado_id:assoc.afiliado_id, tipo:'loja',
      descricao:`10% comissão — Compra na loja`,
      referencia_id:referencia_id||null, valor_usd:comUsd,
      percentagem:10, valor_ton:comTon, currency:'TONCOIN', status:'disponivel',
    });
    const saldoActual = parseFloat(assoc.afiliados?.saldo_disponivel||0);
    await supabase.from('afiliados').update({ saldo_disponivel:parseFloat((saldoActual+comTon).toFixed(8)) }).eq('id',assoc.afiliado_id);
    res.json({ success:true, comissao_ton:comTon });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ════════════════════════════════════════════════════════
// LOJISTAS / PRODUTOS / STORE
// ════════════════════════════════════════════════════════
app.post('/api/lojista/setup', async (req, res) => {
  const user = await authUser(req);
  if (!user) return res.status(401).json({ error:'Não autenticado' });
  const slug = (req.body.nome_loja||'loja').toLowerCase().replace(/[^a-z0-9]/g,'-').replace(/-+/g,'-')+'-'+user.id.substring(0,6);
  const { error } = await supabase.from('lojistas').upsert({ id:user.id, email:user.email, nome_loja:req.body.nome_loja||'A Minha Loja', slug },{onConflict:'id'});
  if (error) return res.status(500).json({ error:error.message });
  res.json({ success:true, slug });
});
app.get('/api/lojista/me', async (req, res) => {
  const user = await authUser(req);
  if (!user) return res.status(401).json({ error:'Não autenticado' });
  const { data, error } = await supabase.from('lojistas').select('*').eq('id',user.id).single();
  if (error) return res.status(404).json({ error:'Não encontrado' });
  res.json({ success:true, lojista:data });
});
app.put('/api/lojista/perfil', async (req, res) => {
  const user = await authUser(req);
  if (!user) return res.status(401).json({ error:'Não autenticado' });
  const campos = ['nome_loja','descricao','logo_url','banner_url','instagram','facebook','dominio_personalizado'];
  const update = {}; campos.forEach(c=>{ if(req.body[c]!==undefined) update[c]=req.body[c]; });
  const { error } = await supabase.from('lojistas').update(update).eq('id',user.id);
  if (error) return res.status(500).json({ error:error.message });
  res.json({ success:true });
});
app.get('/api/produtos', async (req, res) => {
  const user = await authUser(req);
  if (!user) return res.status(401).json({ error:'Não autenticado' });
  const { data, error } = await supabase.from('produtos').select('*').eq('lojista_id',user.id).order('criado_em',{ascending:false});
  if (error) return res.status(500).json({ error:error.message });
  res.json({ success:true, produtos:data });
});
app.post('/api/produtos', async (req, res) => {
  const user = await authUser(req);
  if (!user) return res.status(401).json({ error:'Não autenticado' });
  const { data:lj } = await supabase.from('lojistas').select('plano').eq('id',user.id).single();
  const lim = LIMITES[lj?.plano||'free'];
  const { count } = await supabase.from('produtos').select('*',{count:'exact',head:true}).eq('lojista_id',user.id);
  if (count>=lim.prods) return res.status(403).json({ error:`Limite de ${lim.prods} produtos atingido.` });
  const imgs = (req.body.imagens||[]).slice(0,lim.imgs);
  const { data, error } = await supabase.from('produtos').insert({ lojista_id:user.id, nome:req.body.nome, descricao:req.body.descricao, preco:parseFloat(req.body.preco), imagens:imgs }).select().single();
  if (error) return res.status(500).json({ error:error.message });
  res.json({ success:true, produto:data });
});
app.put('/api/produtos/:id', async (req, res) => {
  const user = await authUser(req);
  if (!user) return res.status(401).json({ error:'Não autenticado' });
  const { error } = await supabase.from('produtos').update({ nome:req.body.nome, descricao:req.body.descricao, preco:parseFloat(req.body.preco), imagens:req.body.imagens, ativo:req.body.ativo }).eq('id',req.params.id).eq('lojista_id',user.id);
  if (error) return res.status(500).json({ error:error.message });
  res.json({ success:true });
});
app.delete('/api/produtos/:id', async (req, res) => {
  const user = await authUser(req);
  if (!user) return res.status(401).json({ error:'Não autenticado' });
  const { error } = await supabase.from('produtos').delete().eq('id',req.params.id).eq('lojista_id',user.id);
  if (error) return res.status(500).json({ error:error.message });
  res.json({ success:true });
});
app.get('/api/store/:slug', async (req, res) => {
  const { data:loja } = await supabase.from('lojistas').select('*').eq('slug',req.params.slug).eq('status','active').single();
  if (!loja) return res.status(404).json({ error:'Loja não encontrada' });
  const { data:produtos } = await supabase.from('produtos').select('*').eq('lojista_id',loja.id).eq('ativo',true);
  if (loja.plano!=='business') loja.powered_by='DIGIMarket';
  res.json({ success:true, loja, produtos:produtos||[] });
});

// ════════════════════════════════════════════════════════
// ADM
// ════════════════════════════════════════════════════════
app.get('/api/admin/lojistas', async (req, res) => {
  if (!await requireAdmin(req,res)) return;
  let q = supabase.from('lojistas').select('*').order('criado_em',{ascending:false});
  if (req.query.plano) q=q.eq('plano',req.query.plano);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error:error.message });
  res.json({ success:true, lojistas:data });
});
app.put('/api/admin/lojistas/:id', async (req, res) => {
  if (!await requireAdmin(req,res)) return;
  const update={};
  if (req.body.status) update.status=req.body.status;
  if (req.body.plano) update.plano=req.body.plano;
  const { error } = await supabase.from('lojistas').update(update).eq('id',req.params.id);
  if (error) return res.status(500).json({ error:error.message });
  res.json({ success:true });
});
app.delete('/api/admin/lojistas/:id', async (req, res) => {
  if (!await requireAdmin(req,res)) return;
  const { error } = await supabase.auth.admin.deleteUser(req.params.id);
  if (error) return res.status(500).json({ error:error.message });
  res.json({ success:true });
});
app.get('/api/admin/stats', async (req, res) => {
  if (!await requireAdmin(req,res)) return;
  const { count:total } = await supabase.from('lojistas').select('*',{count:'exact',head:true});
  const { count:ativos } = await supabase.from('lojistas').select('*',{count:'exact',head:true}).eq('status','active');
  const { count:afiliados } = await supabase.from('afiliados').select('*',{count:'exact',head:true}).eq('ativo',true);
  const { data:pags } = await supabase.from('pagamentos').select('valor_usd').eq('status','confirmed');
  const { data:saques } = await supabase.from('afiliado_saques').select('valor_ton').eq('status','pago');
  const { data:dist } = await supabase.from('lojistas').select('plano');
  const receitaUSD = pags?.reduce((a,p)=>a+(p.valor_usd||0),0)||0;
  const totalSaques = saques?.reduce((a,s)=>a+(s.valor_ton||0),0)||0;
  const distribuicao = dist?.reduce((acc,l)=>{ acc[l.plano]=(acc[l.plano]||0)+1; return acc; },{});
  res.json({ success:true, total, ativos, afiliados, receitaUSD, totalSaques, distribuicao });
});
app.get('/api/admin/afiliados', async (req, res) => {
  if (!await requireAdmin(req,res)) return;
  const { data, error } = await supabase.from('afiliados').select('*').order('criado_em',{ascending:false});
  if (error) return res.status(500).json({ error:error.message });
  res.json({ success:true, afiliados:data });
});
app.get('/api/admin/saques', async (req, res) => {
  if (!await requireAdmin(req,res)) return;
  const { data, error } = await supabase.from('afiliado_saques')
    .select('*, afiliados(email,codigo)').order('criado_em',{ascending:false});
  if (error) return res.status(500).json({ error:error.message });
  res.json({ success:true, saques:data });
});
app.put('/api/admin/saques/:id', async (req, res) => {
  if (!await requireAdmin(req,res)) return;
  const { status, tx_hash } = req.body;
  await supabase.from('afiliado_saques').update({ status, tx_hash, processado_em:new Date().toISOString() }).eq('id',req.params.id);
  if (status==='pago') {
    const { data:saque } = await supabase.from('afiliado_saques').select('*').eq('id',req.params.id).single();
    if (saque) {
      const { data:af } = await supabase.from('afiliados').select('*').eq('id',saque.afiliado_id).single();
      if (af) {
        await supabase.from('afiliados').update({ saldo_disponivel:0, saldo_pago:parseFloat(((af.saldo_pago||0)+saque.valor_ton).toFixed(8)) }).eq('id',af.id);
        await supabase.from('afiliado_comissoes').update({ status:'pago', pago_em:new Date().toISOString() }).eq('afiliado_id',af.id).eq('status','disponivel');
      }
    }
  }
  res.json({ success:true });
});
app.get('/api/admin/config', async (req, res) => {
  if (!await requireAdmin(req,res)) return;
  res.json({ success:true, config: await getConfig() });
});
app.put('/api/admin/config', async (req, res) => {
  if (!await requireAdmin(req,res)) return;
  const campos=['ton_api_key','ton_carteira_recepcao','ton_usd_rate','taxa_transacao','preco_standard_ton','preco_pro_ton','preco_business_ton','dominio_plataforma'];
  const update={}; campos.forEach(c=>{ if(req.body[c]!==undefined) update[c]=req.body[c]; });
  const { error } = await supabase.from('config_plataforma').update(update).eq('id',1);
  if (error) return res.status(500).json({ error:error.message });
  res.json({ success:true });
});

app.get('/health', (_,res) => res.json({ status:'ok', timestamp:new Date() }));
const PORT = process.env.PORT||3000;
app.listen(PORT, ()=>console.log(`DIGIMarket API na porta ${PORT}`));
