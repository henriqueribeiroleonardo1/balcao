// Painel do Balcão. Só conversa com a API (rotas /v1): na demonstração, com a cópia que roda no navegador;
// no painel.html, com o servidor de verdade.
window.BalcaoInbox = (() => {
  const escape = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );

  const ago = (iso) => {
    const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
    if (minutes < 1) return 'agora';
    if (minutes < 60) return `há ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `há ${hours} h`;
    const days = Math.round(hours / 24);
    return days === 1 ? 'ontem' : `há ${days} dias`;
  };

  const icon = (path) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  const ICONS = {
    inbox: icon('<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v6H3v-6z"/>'),
    clock: icon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    chat: icon('<path d="M4 5h16v11H8l-4 4z"/>'),
    check: icon('<path d="M5 12l4 4 10-10"/>'),
    x: icon('<path d="M6 6l12 12M18 6L6 18"/>'),
    flag: icon('<path d="M5 21V4h11l-2 4 2 4H5"/>'),
    chart: icon('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  };

  const VIEWS = [
    { id: 'novo', label: 'Caixa de entrada', icon: 'inbox', filter: (l) => l.status === 'novo' && !l.suspicious },
    { id: 'parados', label: 'Parados', icon: 'clock', filter: (l) => l.stale, hot: true },
    { id: 'em contato', label: 'Em contato', icon: 'chat', filter: (l) => l.status === 'em contato' },
    { id: 'fechado', label: 'Fechados', icon: 'check', filter: (l) => l.status === 'fechado' },
    { id: 'perdido', label: 'Perdidos', icon: 'x', filter: (l) => l.status === 'perdido' },
    { id: 'suspeitos', label: 'Suspeitos', icon: 'flag', filter: (l) => l.suspicious && l.status === 'novo' },
  ];
  const STATUSES = ['novo', 'em contato', 'fechado', 'perdido'];

  function mount(root, { request, title = 'Balcão' }) {
    const state = { view: 'novo', business: '', leads: [], businesses: [], selected: null, fresh: null };

    root.innerHTML = `
      <div class="app">
        <div class="app-bar">
          <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
          <span>${escape(title)}</span>
          <select id="biz-filter" aria-label="Filtrar por negócio"><option value="">Todos os negócios</option></select>
        </div>
        <div class="app-body">
          <nav class="side" aria-label="Pastas"></nav>
          <div class="list" role="listbox" aria-label="Pedidos"></div>
          <article class="detail" aria-live="polite"></article>
          <div class="overview" hidden></div>
        </div>
      </div>`;

    const $ = (selector) => root.querySelector(selector);
    const side = $('.side');
    const list = $('.list');
    const detail = $('.detail');
    const overview = $('.overview');
    const select = $('#biz-filter');

    const query = () => (state.business ? `?business=${encodeURIComponent(state.business)}` : '');

    async function load() {
      const [leads, businesses] = await Promise.all([
        request('GET', `/v1/leads${query()}`),
        state.businesses.length ? null : request('GET', '/v1/businesses'),
      ]);
      if (leads.status === 401) throw Object.assign(new Error('unauthorized'), { status: 401 });
      state.leads = leads.data.data;
      if (businesses) {
        state.businesses = businesses.data.data;
        select.innerHTML += state.businesses
          .map((b) => `<option value="${escape(b.slug)}">${escape(b.name)}</option>`)
          .join('');
      }
    }

    const visible = () => {
      const view = VIEWS.find((v) => v.id === state.view);
      return view ? state.leads.filter(view.filter) : [];
    };

    function renderSide() {
      const counts = Object.fromEntries(VIEWS.map((v) => [v.id, state.leads.filter(v.filter).length]));
      side.innerHTML =
        VIEWS.map(
          (v) => `
          <button type="button" data-view="${v.id}" aria-pressed="${state.view === v.id}">
            ${ICONS[v.icon]} ${v.label}
            <span class="n ${v.hot && counts[v.id] ? 'hot' : ''}">${counts[v.id] || ''}</span>
          </button>`,
        ).join('') +
        `<h4>Relatórios</h4>
        <button type="button" data-view="resumo" aria-pressed="${state.view === 'resumo'}">${ICONS.chart} Visão geral</button>`;
    }

    function tagsFor(lead) {
      const tags = [];
      if (lead.triage && lead.status === 'novo') {
        tags.push(
          `<span class="tag prio-${lead.triage.priority === 'média' ? 'media' : lead.triage.priority}">prioridade ${escape(lead.triage.priority)}</span>`,
        );
      }
      if (lead.urgency === 'alta' && lead.status === 'novo') tags.push('<span class="tag urgent">urgente</span>');
      if (lead.urgency === 'prazo' && lead.status === 'novo') tags.push('<span class="tag deadline">com prazo</span>');
      if (lead.bigOrder) tags.push('<span class="tag">pedido grande</span>');
      if (lead.mismatch) tags.push('<span class="tag stale">conferir</span>');
      if (lead.stale) tags.push('<span class="tag stale">parado</span>');
      if (lead.status === 'fechado') tags.push('<span class="tag done">fechado</span>');
      if (lead.suspicious) tags.push('<span class="tag">suspeito</span>');
      return tags.join('');
    }

    function renderList() {
      const leads = visible();
      if (!leads.some((l) => l.id === state.selected)) state.selected = leads[0]?.id ?? null;
      list.innerHTML = leads.length
        ? leads
            .map(
              (l) => `
            <button type="button" class="row ${l.id === state.fresh ? 'fresh' : ''}" role="option" data-id="${escape(l.id)}" aria-selected="${l.id === state.selected}">
              <span class="row-top"><strong>${escape(l.name)}</strong><time datetime="${escape(l.createdAt)}">${ago(l.createdAt)}</time></span>
              <span class="row-meta" style="display:block">${escape(l.businessName)}${l.serviceName ? ` · ${escape(l.serviceName)}` : ''}</span>
              <span class="row-text">${escape(l.message)}</span>
              <span class="tags">${tagsFor(l)}</span>
            </button>`,
            )
            .join('')
        : `<p class="list-empty">${
            state.view === 'parados' ? 'Nenhum pedido parado. Todo mundo foi respondido a tempo.' : 'Nada por aqui.'
          }</p>`;
    }

    function renderDetail() {
      const lead = state.leads.find((l) => l.id === state.selected);
      if (!lead) {
        detail.innerHTML = '<p class="list-empty">Escolha um pedido para ver os detalhes.</p>';
        return;
      }
      const triage = lead.triage
        ? `<div class="ai agent">
            <p><strong>Prioridade ${escape(lead.triage.priority)}.</strong> ${escape(lead.triage.reason ?? '')}</p>
            <p>${escape(lead.triage.summary)}</p>
            ${lead.triage.suggestedReply ? `<p class="suggested">“${escape(lead.triage.suggestedReply)}”</p>` : ''}
          </div>`
        : `<div class="ai">${
            lead.suspicious
              ? 'Pedido suspeito: a API não acionou o n8n e o dono não foi incomodado.'
              : 'Aguardando o agente do n8n.'
          }</div>`;
      detail.innerHTML = `
        <h3>${escape(lead.name)}</h3>
        <p class="who">${escape(lead.phoneDisplay)}${lead.email ? ` · ${escape(lead.email)}` : ''}<br>${escape(lead.businessName)} · ${ago(lead.createdAt)}</p>
        <blockquote>${escape(lead.message)}</blockquote>
        <h4>Por que o Balcão classificou assim</h4>
        <ul class="signals">${
          lead.signals.length
            ? lead.signals.map((s) => `<li>${escape(s)}</li>`).join('')
            : '<li>nenhum sinal especial</li>'
        }</ul>
        <h4>Decisão do agente (n8n)</h4>
        ${triage}
        <div class="reply">
          <a class="btn btn-light" href="${escape(lead.replyLink)}" target="_blank" rel="noopener">Responder no WhatsApp</a>
        </div>
        <h4>Status</h4>
        <div class="status-group" role="group" aria-label="Status do pedido">
          ${STATUSES.map(
            (s) =>
              `<button type="button" data-status="${s}" aria-pressed="${lead.status === s}">${s[0].toUpperCase() + s.slice(1)}</button>`,
          ).join('')}
        </div>`;
    }

    async function renderOverview() {
      const { data } = await request('GET', `/v1/stats${query()}`);
      const max = Math.max(1, ...data.perDay.map((d) => d.count));
      const pct = data.closeRate === null ? '–' : `${Math.round(data.closeRate * 100)}%`;
      const hours = data.medianResponseHours === null ? '–' : `${String(data.medianResponseHours).replace('.', ',')} h`;
      overview.innerHTML = `
        <div class="tiles">
          <div class="tile"><b>${data.total}</b><span>pedidos</span></div>
          <div class="tile"><b>${pct}</b><span>viraram serviço</span></div>
          <div class="tile"><b>${hours}</b><span>até a 1ª resposta</span></div>
          <div class="tile"><b>${data.stale}</b><span>parados agora</span></div>
        </div>
        <h4 style="margin:24px 0 4px;font-weight:500;color:var(--faint);font-size:13px">Pedidos por dia, últimos 14 dias</h4>
        <div class="bars" role="img" aria-label="Pedidos por dia">
          ${data.perDay
            .map(
              (d, i) =>
                `<div class="${i === data.perDay.length - 1 ? 'today' : ''}" style="height:${(d.count / max) * 100}%" title="${d.day}: ${d.count}">${
                  i % 3 === 1 || i === data.perDay.length - 1
                    ? `<span>${d.day.slice(8)}/${d.day.slice(5, 7)}</span>`
                    : ''
                }</div>`,
            )
            .join('')}
        </div>
        <h4 style="margin:24px 0 4px;font-weight:500;color:var(--faint);font-size:13px">O que mais pedem</h4>
        <ul class="services">${data.byService
          .slice(0, 6)
          .map((s) => `<li><span>${escape(s.name)}</span><span>${s.count}</span></li>`)
          .join('')}</ul>
        ${data.suspicious ? `<p style="color:var(--faint);font-size:13px">${data.suspicious} pedido(s) suspeito(s) fora da conta.</p>` : ''}`;
    }

    async function render() {
      renderSide();
      const showOverview = state.view === 'resumo';
      overview.hidden = !showOverview;
      list.hidden = showOverview;
      detail.hidden = showOverview;
      if (showOverview) return renderOverview();
      renderList();
      renderDetail();
    }

    async function refresh({ highlight } = {}) {
      await load();
      if (highlight) {
        state.fresh = highlight;
        state.selected = highlight;
        const lead = state.leads.find((l) => l.id === highlight);
        if (lead) state.view = lead.suspicious ? 'suspeitos' : 'novo';
      }
      await render();
      state.fresh = null;
    }

    side.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-view]');
      if (!button) return;
      state.view = button.dataset.view;
      render();
    });
    list.addEventListener('click', (event) => {
      const row = event.target.closest('.row');
      if (!row) return;
      state.selected = row.dataset.id;
      for (const r of list.querySelectorAll('.row')) r.setAttribute('aria-selected', String(r === row));
      renderDetail();
    });
    detail.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-status]');
      if (!button || !state.selected) return;
      await request('PATCH', `/v1/leads/${encodeURIComponent(state.selected)}`, { status: button.dataset.status });
      await refresh();
    });
    select.addEventListener('change', () => {
      state.business = select.value;
      refresh();
    });

    return { refresh };
  }

  return { mount };
})();
