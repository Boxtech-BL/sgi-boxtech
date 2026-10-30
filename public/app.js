'use strict';

// ---------- Utilitários ----------
const $app = document.getElementById('app');
let CAT = null;
let EU = null; // usuário logado
const ADM = () => EU?.papel === 'admin';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtNota = (n) => (n == null ? '–' : n.toFixed(1).replace('.', ','));
const fmtData = (d) => (d ? d.split('-').reverse().join('/') : '–');
const nomeTipo = (t) => CAT.tiposAvaliacao.find((x) => x.id === t)?.nome ?? t;
const nomeArea = (a) => CAT.areas.find((x) => x.id === a)?.nome ?? a;

async function api(metodo, url, corpo) {
  const r = await fetch(url, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : {},
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  if (r.status === 204) return null;
  const dados = await r.json();
  if (!r.ok) throw new Error(dados.erro || 'Erro na requisição');
  return dados;
}

let timerAviso;
function avisar(msg, erro = false) {
  const el = document.getElementById('aviso');
  el.textContent = msg;
  el.className = 'visivel' + (erro ? ' erro' : '');
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => (el.className = ''), 3000);
}

const dadosForm = (form) => Object.fromEntries(new FormData(form).entries());

function seloNota(n) {
  if (n == null) return '<span class="selo">sem nota</span>';
  const cls = n >= 3 ? 'ok' : n >= 2 ? 'alerta' : 'erro';
  return `<span class="selo ${cls}">${fmtNota(n)}</span>`;
}

// ---------- Gráfico radar (SVG) ----------
function radar(series, rotulos, tamanho = 480) {
  const c = tamanho / 2, raio = c - 95, n = rotulos.length;
  const ponto = (i, v) => {
    const ang = (Math.PI * 2 * i) / n - Math.PI / 2;
    const r = (raio * v) / 5;
    return [c + r * Math.cos(ang), c + r * Math.sin(ang)];
  };
  let svg = `<svg class="radar" viewBox="0 0 ${tamanho} ${tamanho}" width="100%" style="max-width:${tamanho}px" role="img" aria-label="Radar de maturidade">`;
  for (let nivel = 1; nivel <= 5; nivel++) {
    svg += `<polygon class="grade-radar" points="${rotulos.map((_, i) => ponto(i, nivel).join(',')).join(' ')}"/>`;
  }
  rotulos.forEach((r, i) => {
    const [x, y] = ponto(i, 5);
    svg += `<line class="grade-radar" x1="${c}" y1="${c}" x2="${x}" y2="${y}"/>`;
    const [tx, ty] = ponto(i, 5.9);
    const anc = Math.abs(tx - c) < 8 ? 'middle' : tx > c ? 'start' : 'end';
    svg += `<text x="${tx}" y="${ty}" text-anchor="${anc}" dominant-baseline="middle">${esc(r)}</text>`;
  });
  for (const s of series) {
    svg += `<polygon class="${s.classe}" points="${s.valores.map((v, i) => ponto(i, v ?? 0).join(',')).join(' ')}"/>`;
  }
  return svg + '</svg>';
}


// ---------- Telas ----------
async function telaClientes() {
  const clientes = await api('GET', '/api/clientes');
  // A empresa só tem o próprio cadastro: vai direto para ele.
  if (!ADM() && clientes.length === 1) { location.replace(`#/clientes/${clientes[0].id}/avaliacoes`); return; }
  const rotAcesso = { pendente: '<span class="selo alerta">aguardando liberação</span>', recusado: '<span class="selo erro">recusado</span>', bloqueado: '<span class="selo erro">bloqueado</span>' };
  $app.innerHTML = `
    <h1>Clientes</h1>
    <p class="sub">Acompanhe a maturidade de TIC, o projeto de implantação e os indicadores de cada cliente.</p>
    <div class="grade">
      ${clientes.map((c) => `
        <a class="painel" href="#/clientes/${c.id}/avaliacoes" style="text-decoration:none;color:inherit">
          <div class="linha entre"><h3>${esc(c.nome)}</h3>${seloNota(c.nota_atual)}</div>
          <p class="sub" style="margin:0">${esc(c.segmento || 'Segmento não informado')} · ${esc(c.porte || 'porte não informado')}</p>
          <p class="sub" style="margin:4px 0 0">${c.projetos_ativos} projeto(s) ativo(s) ${rotAcesso[c.acesso] || ''}</p>
        </a>`).join('') || '<p class="vazio">Nenhum cliente cadastrado ainda.</p>'}
    </div>
    ${ADM() ? `<h2>Novo cliente</h2>
    <form class="painel campos" id="novo-cliente">
      <label>Nome<input name="nome" required></label>
      <label>CNPJ<input name="cnpj"></label>
      <label>Segmento<input name="segmento" placeholder="ex.: saúde, varejo"></label>
      <label>Porte<select name="porte"><option value="">–</option><option value="pequeno">Pequeno</option><option value="medio">Médio</option><option value="grande">Grande</option></select></label>
      <label>Contato<input name="contato" placeholder="nome, e-mail ou telefone"></label>
      <label><button class="primario">Cadastrar</button></label>
    </form>` : ''}`;
  const form = document.getElementById('novo-cliente');
  if (form) form.onsubmit = async (e) => {
    e.preventDefault();
    const d = dadosForm(e.target);
    if (!d.porte) delete d.porte;
    try {
      const c = await api('POST', '/api/clientes', d);
      location.hash = `#/clientes/${c.id}/avaliacoes`;
    } catch (err) { avisar(err.message, true); }
  };
}

async function telaCliente(id, aba) {
  const cliente = await api('GET', `/api/clientes/${id}`);
  const abas = [['avaliacoes', 'Maturidade'], ['projeto', 'Projeto de implantação'], ['indicadores', 'Indicadores'], ['dados', 'Cadastro']];
  $app.innerHTML = `
    <p class="sub" style="margin:0"><a href="#/">Clientes</a></p>
    <h1>${esc(cliente.nome)}</h1>
    <nav class="abas">${abas.map(([k, n]) => `<a href="#/clientes/${id}/${k}" class="${k === aba ? 'ativa' : ''}">${n}</a>`).join('')}</nav>
    <section id="conteudo"></section>`;
  const alvo = document.getElementById('conteudo');
  const telas = { avaliacoes: abaAvaliacoes, projeto: abaProjeto, indicadores: abaIndicadores, dados: abaDados };
  await (telas[aba] || abaAvaliacoes)(cliente, alvo);
}

async function abaAvaliacoes(cliente, alvo) {
  const lista = await api('GET', `/api/clientes/${cliente.id}/avaliacoes`);
  alvo.innerHTML = `
    <div class="linha entre">
      <p class="sub" style="margin:0">Nota de 1 a 5 por prática, com base em evidências. Repetir no encerramento e a cada 6 meses.</p>
      <form id="nova-av" class="linha">
        <select name="tipo">${CAT.tiposAvaliacao.map((t) => `<option value="${t.id}">${t.nome}</option>`).join('')}</select>
        <button class="primario">Nova avaliação</button>
      </form>
    </div>
    <div class="painel tabela-rolagem" style="margin-top:16px">
      <table>
        <thead><tr><th>Data</th><th>Tipo</th><th>Consultor</th><th>Status</th><th>Nota geral</th><th></th></tr></thead>
        <tbody>${lista.map((a) => `
          <tr>
            <td>${fmtData(a.data)}</td><td>${esc(nomeTipo(a.tipo))}</td><td>${esc(a.consultor || '–')}</td>
            <td>${a.status === 'concluida' ? '<span class="selo ok">concluída</span>' : '<span class="selo">rascunho</span>'}</td>
            <td>${seloNota(a.geral)}</td>
            <td style="text-align:right"><a href="#/avaliacoes/${a.id}">Abrir</a> · <a href="#/avaliacoes/${a.id}/relatorio">Relatório</a></td>
          </tr>`).join('') || '<tr><td colspan="6" class="vazio">Nenhuma avaliação ainda.</td></tr>'}
        </tbody>
      </table>
    </div>`;
  document.getElementById('nova-av').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const a = await api('POST', `/api/clientes/${cliente.id}/avaliacoes`, dadosForm(e.target));
      location.hash = `#/avaliacoes/${a.id}`;
    } catch (err) { avisar(err.message, true); }
  };
}

async function telaAvaliacao(id) {
  let av = await api('GET', `/api/avaliacoes/${id}`);
  const itens = new Map(av.itens.map((i) => [i.pratica_id, { ...i }]));
  const bloqueada = () => av.status === 'concluida';

  const desenharResultado = () => {
    const r = av.resultado;
    const atuais = CAT.praticas.map((p) => itens.get(p.id)?.nivel ?? 0);
    const metas = CAT.praticas.map((p) => itens.get(p.id)?.meta ?? 0);
    const series = [{ classe: 'meta', valores: metas }, { classe: 'atual', valores: atuais }];
    if (av.anterior) series.unshift({ classe: 'anterior', valores: av.anterior.comparacao.map((c) => c.anterior ?? 0) });
    document.getElementById('resultado').innerHTML = `
      <div class="grade">
        <div class="painel">
          <h3>Nota geral</h3>
          <div class="nota">${fmtNota(r.geral)}</div>
          <p class="sub" style="margin:6px 0 0">${r.completa ? 'Todas as práticas avaliadas' : 'Avaliação incompleta'}</p>
          <table style="margin-top:12px">${r.areas.map((a) => `<tr><td>${esc(a.nome)}${a.peso !== 1 ? ` <span class="selo">peso ${a.peso}</span>` : ''}</td><td style="text-align:right">${seloNota(a.nota)}</td></tr>`).join('')}</table>
        </div>
        <div class="painel">
          <h3>3 lacunas mais críticas</h3>
          ${r.criticas.length ? `<ol style="padding-left:18px;margin:0">${r.criticas.map((l) => `<li>${esc(l.nome)}: nível ${l.nivel} → meta ${l.meta}${l.onda ? ` <span class="selo">onda ${l.onda}</span>` : ''}</li>`).join('')}</ol>` : '<p class="sub">Nenhuma lacuna em relação às metas.</p>'}
          ${av.anterior ? `<p class="sub" style="margin-top:12px">Comparada à avaliação de ${fmtData(av.anterior.data)}.</p>` : ''}
        </div>
      </div>
      <div class="painel" style="margin-top:16px;text-align:center">
        ${radar(series, CAT.praticas.map((p) => p.curto))}
        <div class="legenda" style="justify-content:center">
          <span><i style="background:var(--primaria)"></i>Nível atual</span>
          <span><i style="background:var(--ok)"></i>Meta</span>
          ${av.anterior ? '<span><i style="background:var(--suave)"></i>Avaliação anterior</span>' : ''}
        </div>
      </div>`;
  };

  const linhaPratica = (p) => {
    const i = itens.get(p.id) || {};
    const dis = bloqueada() ? 'disabled' : '';
    return `
      <div class="pratica" data-p="${p.id}">
        <div>
          <h3>${esc(p.nome)} ${p.onda ? `<span class="selo">onda ${p.onda}</span>` : '<span class="selo">PMBOK</span>'}</h3>
          <p><strong>Perguntas:</strong> ${esc(p.perguntas)}</p>
          <p><strong>Evidências a pedir:</strong> ${esc(p.evidencias)}</p>
          <label style="margin-top:8px">Evidências encontradas<textarea data-campo="evidencias" ${dis}>${esc(i.evidencias)}</textarea></label>
        </div>
        <div>
          <label>Nível atual</label>
          <div class="nivel" data-campo="nivel">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-n="${n}" class="${i.nivel === n ? 'sel' : ''}" title="${esc(CAT.niveis[n - 1].nome)}" ${dis}>${n}</button>`).join('')}</div>
          <label style="margin-top:10px">Meta
            <select data-campo="meta" ${dis}>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${i.meta === n ? 'selected' : ''}>${n} · ${CAT.niveis[n - 1].nome}</option>`).join('')}</select>
          </label>
          <label>Observações / o que falta para o próximo nível<textarea data-campo="observacoes" ${dis}>${esc(i.observacoes)}</textarea></label>
        </div>
      </div>`;
  };

  const desenhar = () => {
    $app.innerHTML = `
      <p class="sub" style="margin:0"><a href="#/clientes/${av.cliente.id}/avaliacoes">${esc(av.cliente.nome)}</a></p>
      <div class="linha entre">
        <div><h1>${esc(nomeTipo(av.tipo))}</h1><p class="sub">${fmtData(av.data)} · ${av.status === 'concluida' ? 'concluída' : 'rascunho'}</p></div>
        <div class="linha nao-imprimir">
          <a class="botao" href="#/avaliacoes/${av.id}/relatorio">Relatório</a>
          ${bloqueada() ? (ADM() ? '<button id="reabrir">Reabrir</button>' : '') : `<button id="salvar" ${ADM() ? '' : 'class="primario"'}>Salvar</button>${ADM() ? '<button id="concluir" class="primario">Concluir avaliação</button>' : ''}`}
        </div>
      </div>
      <div class="painel">
        <form class="campos" id="cab">
          <label>Data<input type="date" name="data" value="${esc(av.data)}" ${bloqueada() ? 'disabled' : ''}></label>
          <label>Consultor ITIL<input name="consultor" value="${esc(av.consultor)}" ${bloqueada() ? 'disabled' : ''}></label>
          ${CAT.areas.map((a) => `<label>Peso: ${esc(a.nome)}<select name="peso_${a.id}" ${bloqueada() ? 'disabled' : ''}>${[1, 2, 3].map((n) => `<option ${(av.pesos[a.id] || 1) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`).join('')}
        </form>
        <p class="sub" style="margin:0;font-size:13px">Regra: a prática recebe o maior nível cujas evidências foram todas confirmadas. Na dúvida entre dois níveis, fica o menor.</p>
      </div>
      <h2>Resultado</h2>
      <div id="resultado"></div>
      <h2>Questionário por prática</h2>
      ${CAT.areas.map((a) => `
        <div class="painel" style="margin-bottom:16px">
          <h3 style="color:var(--primaria)">${esc(a.nome)} <span class="selo">${esc(a.referencia)}</span></h3>
          ${CAT.praticas.filter((p) => p.area === a.id).map(linhaPratica).join('')}
        </div>`).join('')}`;
    desenharResultado();
    ligarEventos();
  };

  const montarCorpo = (status) => {
    const cab = dadosForm(document.getElementById('cab'));
    const pesos = {};
    for (const a of CAT.areas) if (Number(cab[`peso_${a.id}`]) !== 1) pesos[a.id] = Number(cab[`peso_${a.id}`]);
    return { data: cab.data, consultor: cab.consultor, pesos, status, itens: [...itens.values()] };
  };

  const salvar = async (status) => {
    try {
      av = await api('PUT', `/api/avaliacoes/${av.id}`, montarCorpo(status));
      avisar(status === 'concluida' ? 'Avaliação concluída' : 'Avaliação salva');
      desenhar();
    } catch (err) { avisar(err.message, true); }
  };

  const ligarEventos = () => {
    document.querySelectorAll('.pratica').forEach((el) => {
      const item = itens.get(el.dataset.p);
      el.querySelectorAll('.nivel button').forEach((b) => (b.onclick = () => {
        const n = Number(b.dataset.n);
        item.nivel = item.nivel === n ? null : n;
        el.querySelectorAll('.nivel button').forEach((x) => x.classList.toggle('sel', Number(x.dataset.n) === item.nivel));
        // Recalcula localmente para dar retorno imediato; o servidor recalcula ao salvar.
        av.resultado = calcularLocal();
        desenharResultado();
      }));
      el.querySelector('[data-campo=meta]').onchange = (e) => { item.meta = Number(e.target.value); av.resultado = calcularLocal(); desenharResultado(); };
      el.querySelectorAll('textarea').forEach((t) => (t.oninput = () => (item[t.dataset.campo] = t.value)));
    });
    document.getElementById('salvar')?.addEventListener('click', () => salvar('rascunho'));
    document.getElementById('concluir')?.addEventListener('click', () => salvar('concluida'));
    document.getElementById('reabrir')?.addEventListener('click', async () => {
      try { av = await api('PUT', `/api/avaliacoes/${av.id}`, { status: 'rascunho' }); desenhar(); } catch (err) { avisar(err.message, true); }
    });
  };

  // Mesmo cálculo de src/maturidade.js, para a prévia na tela.
  const calcularLocal = () => {
    const cab = dadosForm(document.getElementById('cab'));
    const arred = (n) => Math.round(n * 10) / 10;
    const areas = CAT.areas.map((a) => {
      const ns = CAT.praticas.filter((p) => p.area === a.id).map((p) => itens.get(p.id)?.nivel).filter((n) => n != null);
      return { area: a.id, nome: a.nome, peso: Number(cab[`peso_${a.id}`]) || 1, nota: ns.length ? arred(ns.reduce((x, y) => x + y, 0) / ns.length) : null };
    });
    const com = areas.filter((a) => a.nota != null);
    const sp = com.reduce((s, a) => s + a.peso, 0);
    const lacunas = CAT.praticas.map((p) => ({ ...itens.get(p.id), nome: p.nome, onda: p.onda }))
      .filter((l) => l.nivel != null && l.meta != null && l.meta > l.nivel)
      .sort((a, b) => (b.meta - b.nivel) - (a.meta - a.nivel) || (a.onda ?? 0) - (b.onda ?? 0));
    return { geral: sp ? arred(com.reduce((s, a) => s + a.nota * a.peso, 0) / sp) : null, areas, lacunas, criticas: lacunas.slice(0, 3), completa: CAT.praticas.every((p) => itens.get(p.id)?.nivel != null) };
  };

  desenhar();
}

async function telaRelatorio(id) {
  const av = await api('GET', `/api/avaliacoes/${id}`);
  const r = av.resultado;
  const itens = new Map(av.itens.map((i) => [i.pratica_id, i]));
  const series = [{ classe: 'meta', valores: CAT.praticas.map((p) => itens.get(p.id)?.meta ?? 0) }, { classe: 'atual', valores: CAT.praticas.map((p) => itens.get(p.id)?.nivel ?? 0) }];
  const recomendacoes = r.lacunas.slice().sort((a, b) => (a.onda ?? 0) - (b.onda ?? 0) || b.lacuna - a.lacuna);
  $app.innerHTML = `
    <div class="linha entre nao-imprimir" style="margin-bottom:16px">
      <a href="#/avaliacoes/${av.id}">← Voltar à avaliação</a>
      <button class="primario" id="imprimir">Imprimir / salvar PDF</button>
    </div>
    <div class="painel">
      <h1>Relatório de maturidade de TIC</h1>
      <p class="sub">${esc(av.cliente.nome)} · ${esc(nomeTipo(av.tipo))} · ${fmtData(av.data)}${av.consultor ? ` · Consultor: ${esc(av.consultor)}` : ''}</p>
      ${av.status !== 'concluida' ? '<p><span class="selo alerta">Rascunho: avaliação ainda não concluída</span></p>' : ''}

      <h2>1. Resumo executivo</h2>
      <p>Nota geral <strong>${fmtNota(r.geral)}</strong> numa escala de 1 a 5.</p>
      <table><thead><tr><th>Área</th><th>Nota</th><th>Peso</th></tr></thead>
        <tbody>${r.areas.map((a) => `<tr><td>${esc(a.nome)}</td><td>${fmtNota(a.nota)}</td><td>${a.peso}</td></tr>`).join('')}</tbody></table>
      <p style="margin-top:12px"><strong>Lacunas mais críticas:</strong> ${r.criticas.map((l) => `${esc(l.nome)} (${l.nivel} → ${l.meta})`).join('; ') || 'nenhuma'}.</p>

      <h2>2. Nível atual e meta por prática</h2>
      <div style="text-align:center">${radar(series, CAT.praticas.map((p) => p.curto))}
        <div class="legenda" style="justify-content:center"><span><i style="background:var(--primaria)"></i>Nível atual</span><span><i style="background:var(--ok)"></i>Meta</span></div></div>

      <h2>3. Detalhe por prática</h2>
      <div class="tabela-rolagem"><table>
        <thead><tr><th>Prática</th><th>Nível</th><th>Meta</th><th>Evidências encontradas</th><th>O que falta</th>${av.anterior ? '<th>Variação</th>' : ''}</tr></thead>
        <tbody>${CAT.praticas.map((p) => {
          const i = itens.get(p.id) || {};
          const c = av.anterior?.comparacao.find((x) => x.pratica === p.id);
          return `<tr><td>${esc(p.nome)}</td><td>${i.nivel ?? '–'}</td><td>${i.meta ?? '–'}</td><td>${esc(i.evidencias || '–')}</td><td>${esc(i.observacoes || '–')}</td>${av.anterior ? `<td>${c?.variacao == null ? '–' : (c.variacao > 0 ? '+' : '') + c.variacao}</td>` : ''}</tr>`;
        }).join('')}</tbody>
      </table></div>

      <h2>4. Recomendações priorizadas</h2>
      ${recomendacoes.length ? `<ol>${recomendacoes.map((l) => `<li><strong>${esc(l.nome)}</strong> (${l.onda ? `onda ${l.onda}` : 'base PMBOK'}): elevar do nível ${l.nivel} para ${l.meta}${itens.get(l.pratica)?.observacoes ? `. ${esc(itens.get(l.pratica).observacoes)}` : ''}</li>`).join('')}</ol>` : '<p>Todas as práticas atingiram a meta.</p>'}
      <p class="sub">As recomendações alimentam o mapa de ondas do roteiro de implantação.</p>
    </div>`;
  document.getElementById('imprimir').onclick = () => window.print();
}

async function abaProjeto(cliente, alvo) {
  const projetos = await api('GET', `/api/clientes/${cliente.id}/projetos`);
  const rotStatusFase = { nao_iniciada: 'Não iniciada', em_andamento: 'Em andamento', concluida: 'Concluída' };
  const rotStatusOnda = { nao_iniciada: 'Não iniciada', desenho: '1. Desenho do processo', configuracao: '2. Configuração', treinamento: '3. Treinamento', piloto: '4. Piloto assistido', aceita: '5. Aceita' };

  alvo.innerHTML = projetos.map((p) => `
    <div class="painel" style="margin-bottom:16px" data-proj="${p.id}">
      <div class="linha entre"><h3>${esc(p.nome)}</h3><span class="selo">${p.progresso}% das fases</span></div>
      <p class="sub" style="margin:0">Patrocinador: ${esc(p.patrocinador || '–')} · Ponto focal: ${esc(p.ponto_focal || '–')} · GP Boxtech: ${esc(p.gerente || '–')} · Início: ${fmtData(p.inicio)}</p>
      <div class="barra" style="margin:10px 0"><i style="width:${p.progresso}%"></i></div>
      <h3 style="margin-top:16px">Fases PMBOK e portões</h3>
      <div class="tabela-rolagem"><table>
        <thead><tr><th>Fase</th><th>Status</th><th>Portão</th><th>Aprovado em</th><th></th></tr></thead>
        <tbody>${p.fases.map((f) => `
          <tr data-fase="${f.fase_id}">
            <td><strong>${f.fase_id}. ${esc(f.nome)}</strong><br><span class="sub">${esc(f.duracao)}</span></td>
            <td><select name="status">${Object.entries(rotStatusFase).map(([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
            <td style="font-size:13px">${esc(f.portao || 'Sem portão (corre em paralelo)')}</td>
            <td>${f.portao ? `<input type="date" name="portao_aprovado_em" value="${esc(f.portao_aprovado_em)}">` : '–'}</td>
            <td>${ADM() ? '<button data-acao="fase">Salvar</button>' : ''}</td>
          </tr>`).join('')}</tbody>
      </table></div>
      <h3 style="margin-top:16px">Ondas ITIL (Fase 3)</h3>
      <div class="grade">${p.ondas.map((o) => `
        <div class="painel" data-onda="${o.onda_id}">
          <h3>Onda ${o.onda_id}: ${esc(o.nome)}</h3>
          <p class="sub" style="margin:0 0 8px;font-size:13px">${esc(o.foco)} · ${esc(o.duracao)}</p>
          <ul style="margin:0 0 10px;padding-left:18px;font-size:14px">${o.praticas.map((id) => `<li>${esc(CAT.praticas.find((x) => x.id === id)?.nome)}</li>`).join('')}</ul>
          <label>Etapa<select name="status">${Object.entries(rotStatusOnda).map(([k, v]) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label>Termo de aceite em<input type="date" name="aceite_em" value="${esc(o.aceite_em)}"></label>
          ${ADM() ? '<button data-acao="onda">Salvar</button>' : ''}
        </div>`).join('')}</div>
    </div>`).join('') + (ADM() ? `
    <h2>Novo projeto de implantação</h2>
    <form class="painel campos" id="novo-proj">
      <label>Nome do projeto<input name="nome" required value="Implantação de boas práticas de TIC"></label>
      <label>Patrocinador (cliente)<input name="patrocinador"></label>
      <label>Ponto focal de TI (cliente)<input name="ponto_focal"></label>
      <label>Gerente de projeto (Boxtech)<input name="gerente"></label>
      <label>Início<input type="date" name="inicio"></label>
      <label><button class="primario">Criar projeto</button></label>
    </form>` : (projetos.length ? '' : '<p class="vazio">O projeto de implantação aparece aqui quando a Boxtech iniciá-lo.</p>'));
  if (!ADM()) alvo.querySelectorAll('select, input').forEach((el) => (el.disabled = true));

  const recarregar = () => abaProjeto(cliente, alvo);
  alvo.querySelectorAll('[data-acao=fase]').forEach((b) => (b.onclick = async () => {
    const tr = b.closest('tr'), proj = b.closest('[data-proj]').dataset.proj;
    const corpo = { status: tr.querySelector('[name=status]').value };
    const data = tr.querySelector('[name=portao_aprovado_em]');
    if (data) corpo.portao_aprovado_em = data.value || null;
    try { await api('PUT', `/api/projetos/${proj}/fases/${tr.dataset.fase}`, corpo); avisar('Fase atualizada'); recarregar(); } catch (err) { avisar(err.message, true); }
  }));
  alvo.querySelectorAll('[data-acao=onda]').forEach((b) => (b.onclick = async () => {
    const box = b.closest('[data-onda]'), proj = b.closest('[data-proj]').dataset.proj;
    const corpo = { status: box.querySelector('[name=status]').value, aceite_em: box.querySelector('[name=aceite_em]').value || null };
    try { await api('PUT', `/api/projetos/${proj}/ondas/${box.dataset.onda}`, corpo); avisar('Onda atualizada'); recarregar(); } catch (err) { avisar(err.message, true); }
  }));
  const formProj = document.getElementById('novo-proj');
  if (formProj) formProj.onsubmit = async (e) => {
    e.preventDefault();
    const d = dadosForm(e.target);
    if (!d.inicio) delete d.inicio;
    try { await api('POST', `/api/clientes/${cliente.id}/projetos`, d); avisar('Projeto criado'); recarregar(); } catch (err) { avisar(err.message, true); }
  };
}

async function abaIndicadores(cliente, alvo) {
  const inds = await api('GET', `/api/clientes/${cliente.id}/indicadores`);
  const fmt = (v, u) => (v == null ? '–' : `${String(v).replace('.', ',')}${u === '%' ? '%' : ` ${u}`}`);
  alvo.innerHTML = `
    <p class="sub">Cada prática implantada ganha pelo menos um indicador, comparado com a linha de base medida no Planejamento.</p>
    <div class="painel tabela-rolagem">
      <table>
        <thead><tr><th>Indicador</th><th>Linha de base</th><th>Última medição</th><th>Evolução</th><th>Fonte</th></tr></thead>
        <tbody>${inds.map((i) => `
          <tr>
            <td><strong>${esc(i.nome)}</strong><br><span class="sub" style="font-size:12px">${i.sentido === 'maior' ? 'quanto maior, melhor' : 'quanto menor, melhor'}</span></td>
            <td>${i.linha_base ? `${fmt(i.linha_base.valor, i.unidade)}<br><span class="sub">${esc(i.linha_base.periodo)}</span>` : '–'}</td>
            <td>${i.ultima ? `${fmt(i.ultima.valor, i.unidade)}<br><span class="sub">${esc(i.ultima.periodo)}</span>` : '–'}</td>
            <td>${i.evolucao ? `<span class="selo ${i.evolucao.melhorou ? 'ok' : 'erro'}">${i.evolucao.delta > 0 ? '+' : ''}${String(i.evolucao.delta).replace('.', ',')}</span>` : '–'}</td>
            <td style="font-size:13px">${esc(i.fonte)}</td>
          </tr>`).join('')}</tbody>
      </table>
    </div>
    <h2>Registrar medição</h2>
    <form class="painel campos" id="nova-med">
      <label>Indicador<select name="indicador_id">${inds.map((i) => `<option value="${i.id}">${esc(i.nome)}</option>`).join('')}</select></label>
      <label>Período<input type="month" name="periodo" required></label>
      <label>Valor<input type="number" step="any" name="valor" required></label>
      <label><span><input type="checkbox" name="linha_base" style="width:auto"> É a linha de base</span></label>
      <label><button class="primario">Registrar</button></label>
    </form>
    <h2>Histórico</h2>
    <div class="painel tabela-rolagem">
      <table><thead><tr><th>Período</th><th>Indicador</th><th>Valor</th><th></th></tr></thead>
      <tbody>${inds.flatMap((i) => i.medicoes.map((m) => ({ ...m, ind: i }))).sort((a, b) => b.periodo.localeCompare(a.periodo)).map((m) => `
        <tr><td>${esc(m.periodo)}${m.linha_base ? ' <span class="selo">base</span>' : ''}</td><td>${esc(m.ind.nome)}</td><td>${fmt(m.valor, m.ind.unidade)}</td>
        <td style="text-align:right"><button class="perigo" data-del="${m.id}">Excluir</button></td></tr>`).join('') || '<tr><td colspan="4" class="vazio">Nenhuma medição registrada.</td></tr>'}</tbody></table>
    </div>`;
  document.getElementById('nova-med').onsubmit = async (e) => {
    e.preventDefault();
    const d = dadosForm(e.target);
    try {
      await api('POST', `/api/clientes/${cliente.id}/medicoes`, { indicador_id: d.indicador_id, periodo: d.periodo, valor: Number(d.valor), linha_base: !!d.linha_base });
      avisar('Medição registrada'); abaIndicadores(cliente, alvo);
    } catch (err) { avisar(err.message, true); }
  };
  alvo.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Excluir esta medição?')) return;
    await api('DELETE', `/api/medicoes/${b.dataset.del}`); abaIndicadores(cliente, alvo);
  }));
}

async function abaDados(cliente, alvo) {
  alvo.innerHTML = `
    <form class="painel campos" id="ed-cliente">
      <label>Nome<input name="nome" required value="${esc(cliente.nome)}"></label>
      <label>CNPJ<input name="cnpj" value="${esc(cliente.cnpj)}"></label>
      <label>Segmento<input name="segmento" value="${esc(cliente.segmento)}"></label>
      <label>Porte<select name="porte">${['', 'pequeno', 'medio', 'grande'].map((p) => `<option value="${p}" ${cliente.porte === p ? 'selected' : ''}>${p || '–'}</option>`).join('')}</select></label>
      <label>Contato<input name="contato" value="${esc(cliente.contato)}"></label>
      <label><button class="primario">Salvar</button></label>
    </form>
    ${ADM() ? '<p style="margin-top:24px"><button class="perigo" id="excluir">Excluir cliente e todos os dados</button></p>' : ''}`;
  document.getElementById('ed-cliente').onsubmit = async (e) => {
    e.preventDefault();
    const d = dadosForm(e.target);
    if (!d.porte) d.porte = null;
    try { await api('PUT', `/api/clientes/${cliente.id}`, d); avisar('Cadastro salvo'); rotear(); } catch (err) { avisar(err.message, true); }
  };
  const excluir = document.getElementById('excluir');
  if (excluir) excluir.onclick = async () => {
    if (!confirm(`Excluir ${cliente.nome}, com avaliações, projetos e indicadores? Não dá para desfazer.`)) return;
    await api('DELETE', `/api/clientes/${cliente.id}`);
    location.hash = '#/';
  };
}

function telaFramework() {
  $app.innerHTML = `
    <h1>Framework de gestão de TIC</h1>
    <p class="sub">PMBOK conduz o projeto (fases e portões); ITIL 4 define o que é implantado (práticas em 3 ondas).</p>
    <h2>Escala de maturidade</h2>
    <div class="painel tabela-rolagem"><table><thead><tr><th>Nível</th><th>Nome</th><th>Como a prática funciona</th><th>Evidência típica</th></tr></thead>
      <tbody>${CAT.niveis.map((n) => `<tr><td>${n.nivel}</td><td>${esc(n.nome)}</td><td>${esc(n.descricao)}</td><td>${esc(n.evidencia)}</td></tr>`).join('')}</tbody></table></div>
    <h2>Fases do projeto (PMBOK)</h2>
    <div class="grade">${CAT.fases.map((f) => `<div class="painel"><h3>${f.id}. ${esc(f.nome)}</h3><p class="sub" style="margin:0 0 6px">${esc(f.duracao)}</p><ul style="margin:0;padding-left:18px;font-size:14px">${f.entregaveis.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>${f.portao ? `<p style="font-size:13px;margin:8px 0 0"><strong>Portão:</strong> ${esc(f.portao)}</p>` : ''}</div>`).join('')}</div>
    <h2>Práticas avaliadas</h2>
    <div class="painel tabela-rolagem"><table><thead><tr><th>Prática</th><th>Área</th><th>Onda</th><th>Perguntas-chave</th></tr></thead>
      <tbody>${CAT.praticas.map((p) => `<tr><td>${esc(p.nome)}</td><td>${esc(nomeArea(p.area))}</td><td>${p.onda ? `${p.onda}. ${esc(CAT.ondas[p.onda - 1].nome)}` : 'Base PMBOK'}</td><td>${esc(p.perguntas)}</td></tr>`).join('')}</tbody></table></div>`;
}

// ---------- Acesso ----------
function telaLogin() {
  $app.innerHTML = `
    <div class="painel" style="max-width:420px;margin:40px auto">
      <h1>Entrar no SGI</h1>
      <p class="sub">Sistema de Gestão Integrada de TIC da Boxtech.</p>
      <form id="login">
        <label>E-mail<input type="email" name="email" required autocomplete="username"></label>
        <label>Senha<input type="password" name="senha" required autocomplete="current-password"></label>
        <button class="primario" style="width:100%">Entrar</button>
      </form>
      <p class="sub" style="margin:16px 0 0;text-align:center">Sua empresa ainda não tem acesso? <a href="#/cadastro">Cadastre-se</a></p>
    </div>`;
  document.getElementById('login').onsubmit = async (e) => {
    e.preventDefault();
    try {
      EU = await api('POST', '/api/login', dadosForm(e.target));
      desenharTopo();
      location.hash = '#/';
    } catch (err) { avisar(err.message, true); }
  };
}

function telaCadastro() {
  $app.innerHTML = `
    <div class="painel" style="max-width:640px;margin:24px auto">
      <h1>Cadastro da empresa</h1>
      <p class="sub">Depois do envio, a Boxtech analisa o cadastro e você recebe um e-mail quando o acesso for liberado.</p>
      <form id="cadastro">
        <h3>Empresa</h3>
        <div class="campos" style="display:grid">
          <label>Razão social ou nome<input name="empresa_nome" required maxlength="200"></label>
          <label>CNPJ<input name="cnpj" maxlength="30"></label>
          <label>Segmento<input name="segmento" placeholder="ex.: saúde, varejo" maxlength="200"></label>
          <label>Porte<select name="porte"><option value="">–</option><option value="pequeno">Pequeno</option><option value="medio">Médio</option><option value="grande">Grande</option></select></label>
        </div>
        <h3 style="margin-top:8px">Responsável pelo acesso</h3>
        <div class="campos" style="display:grid">
          <label>Nome<input name="nome" required maxlength="200"></label>
          <label>E-mail<input type="email" name="email" required autocomplete="username"></label>
          <label>Senha (mínimo 8 caracteres)<input type="password" name="senha" required minlength="8" autocomplete="new-password"></label>
          <label>Repita a senha<input type="password" name="senha2" required minlength="8" autocomplete="new-password"></label>
        </div>
        <button class="primario">Enviar cadastro</button>
      </form>
      <p class="sub" style="margin:16px 0 0">Já tem acesso? <a href="#/login">Entrar</a></p>
    </div>`;
  document.getElementById('cadastro').onsubmit = async (e) => {
    e.preventDefault();
    const d = dadosForm(e.target);
    if (d.senha !== d.senha2) return avisar('As senhas não conferem', true);
    try {
      const r = await api('POST', '/api/cadastro', {
        empresa: { nome: d.empresa_nome, cnpj: d.cnpj, segmento: d.segmento, porte: d.porte || null },
        nome: d.nome, email: d.email, senha: d.senha,
      });
      $app.innerHTML = `<div class="painel" style="max-width:560px;margin:40px auto"><h1>Cadastro enviado</h1><p>${esc(r.mensagem)}</p><p><a href="#/login">Ir para o login</a></p></div>`;
    } catch (err) { avisar(err.message, true); }
  };
}

// Página aberta pelo link do e-mail enviado ao aprovador.
async function telaAprovar(token) {
  const desenhar = (u) => {
    const decidido = u.status !== 'pendente';
    $app.innerHTML = `
      <div class="painel" style="max-width:560px;margin:40px auto">
        <h1>Liberação de acesso</h1>
        <table>
          <tr><th>Empresa</th><td>${esc(u.empresa)}</td></tr>
          <tr><th>CNPJ</th><td>${esc(u.cnpj || '–')}</td></tr>
          <tr><th>Segmento / porte</th><td>${esc(u.segmento || '–')} · ${esc(u.porte || '–')}</td></tr>
          <tr><th>Responsável</th><td>${esc(u.nome)} &lt;${esc(u.email)}&gt;</td></tr>
          <tr><th>Cadastrado em</th><td>${esc(u.criado_em)}</td></tr>
          <tr><th>Situação</th><td>${{ pendente: '<span class="selo alerta">aguardando</span>', ativo: '<span class="selo ok">liberado</span>', recusado: '<span class="selo erro">recusado</span>', bloqueado: '<span class="selo erro">bloqueado</span>' }[u.status]}</td></tr>
        </table>
        ${decidido ? '<p class="sub" style="margin-top:16px">Este cadastro já foi decidido.</p>' : `
          <div class="linha" style="margin-top:16px">
            <button class="primario" data-decisao="aprovar">Liberar acesso</button>
            <button class="perigo" data-decisao="recusar">Recusar</button>
          </div>`}
      </div>`;
    $app.querySelectorAll('[data-decisao]').forEach((b) => (b.onclick = async () => {
      if (b.dataset.decisao === 'recusar' && !confirm('Recusar este cadastro? A empresa será avisada por e-mail.')) return;
      try {
        desenhar(await api('POST', `/api/aprovacoes/${encodeURIComponent(token)}`, { decisao: b.dataset.decisao }));
        avisar(b.dataset.decisao === 'aprovar' ? 'Acesso liberado. A empresa foi avisada por e-mail.' : 'Cadastro recusado.');
      } catch (err) { avisar(err.message, true); }
    }));
  };
  desenhar(await api('GET', `/api/aprovacoes/${encodeURIComponent(token)}`));
}

async function telaAdmin() {
  const usuarios = await api('GET', '/api/admin/usuarios');
  const rot = { pendente: '<span class="selo alerta">aguardando</span>', ativo: '<span class="selo ok">liberado</span>', recusado: '<span class="selo erro">recusado</span>', bloqueado: '<span class="selo erro">bloqueado</span>' };
  const acoes = (u) => {
    if (u.papel === 'admin') return '<span class="sub">Boxtech</span>';
    if (u.status === 'pendente') return `<button class="primario" data-id="${u.id}" data-d="aprovar">Liberar</button> <button class="perigo" data-id="${u.id}" data-d="recusar">Recusar</button>`;
    if (u.status === 'ativo') return `<button class="perigo" data-id="${u.id}" data-d="bloquear">Bloquear</button>`;
    return `<button data-id="${u.id}" data-d="reativar">Liberar</button>`;
  };
  $app.innerHTML = `
    <h1>Acessos</h1>
    <p class="sub">Empresas cadastradas no SGI. Novos cadastros também chegam por e-mail com o link para liberar.</p>
    <div class="painel tabela-rolagem"><table>
      <thead><tr><th>Empresa</th><th>Responsável</th><th>Cadastro</th><th>Situação</th><th></th></tr></thead>
      <tbody>${usuarios.map((u) => `<tr>
        <td>${esc(u.empresa || '–')}<br><span class="sub">${esc(u.cnpj || '')}</span></td>
        <td>${esc(u.nome)}<br><span class="sub">${esc(u.email)}</span></td>
        <td>${esc(u.criado_em)}</td>
        <td>${rot[u.status]}${u.decidido_por ? `<br><span class="sub" style="font-size:12px">por ${esc(u.decidido_por)}</span>` : ''}</td>
        <td style="text-align:right;white-space:nowrap">${acoes(u)}</td></tr>`).join('')}</tbody>
    </table></div>`;
  $app.querySelectorAll('[data-d]').forEach((b) => (b.onclick = async () => {
    if (['recusar', 'bloquear'].includes(b.dataset.d) && !confirm(`Confirmar: ${b.dataset.d}?`)) return;
    try { await api('POST', `/api/admin/usuarios/${b.dataset.id}/${b.dataset.d}`, {}); avisar('Situação atualizada'); telaAdmin(); } catch (err) { avisar(err.message, true); }
  }));
}

function desenharTopo() {
  document.getElementById('menu').innerHTML = EU
    ? `${ADM() ? '<a href="#/">Clientes</a><a href="#/admin">Acessos</a>' : '<a href="#/">Minha empresa</a>'}
       <a href="#/framework">Framework</a>
       <span class="usuario">${esc(EU.nome)}</span><a href="#/sair">Sair</a>`
    : '<a href="#/login">Entrar</a><a href="#/cadastro">Cadastre-se</a>';
}

// ---------- Roteador ----------
const PUBLICAS = ['login', 'cadastro', 'aprovar'];

async function rotear() {
  const partes = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  try {
    if (!CAT) CAT = await api('GET', '/api/catalogo');
    if (EU === null) {
      try { EU = await api('GET', '/api/eu'); } catch { EU = false; }
      desenharTopo();
    }
    if (partes[0] === 'sair') {
      await api('POST', '/api/logout', {});
      EU = false; desenharTopo(); location.hash = '#/login'; return;
    }
    if (partes[0] === 'aprovar' && partes[1]) await telaAprovar(partes[1]);
    else if (partes[0] === 'cadastro') telaCadastro();
    else if (partes[0] === 'login' || !EU) {
      if (!EU && !PUBLICAS.includes(partes[0])) history.replaceState(null, '', '#/login');
      if (EU) { location.hash = '#/'; return; }
      telaLogin();
    }
    else if (partes[0] === 'clientes' && partes[1]) await telaCliente(partes[1], partes[2] || 'avaliacoes');
    else if (partes[0] === 'avaliacoes' && partes[2] === 'relatorio') await telaRelatorio(partes[1]);
    else if (partes[0] === 'avaliacoes' && partes[1]) await telaAvaliacao(partes[1]);
    else if (partes[0] === 'framework') telaFramework();
    else if (partes[0] === 'admin') await telaAdmin();
    else await telaClientes();
    window.scrollTo(0, 0);
  } catch (err) {
    if (/Faça login/.test(err.message)) { EU = false; desenharTopo(); location.hash = '#/login'; return; }
    $app.innerHTML = `<p class="vazio">${esc(err.message)}</p>`;
  }
}

window.addEventListener('hashchange', rotear);
rotear();
