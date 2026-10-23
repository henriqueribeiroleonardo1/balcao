// Demonstração da página inicial: um "site de cliente" fictício mandando pedidos para a API,
// que roda aqui mesmo no navegador (balcao.js), e o painel do dono mostrando o resultado.
(() => {
  const $ = (selector) => document.querySelector(selector);
  const escape = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );

  /* ---------- API local ---------- */

  const call = async (method, path, body, headers = {}) => {
    const res = await Balcao.request(method, path, {
      ...(body !== undefined && { body }),
      headers: { authorization: `Bearer ${Balcao.DEMO_TOKEN}`, ...headers },
    });
    return { status: res.status, data: await res.json() };
  };

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.BalcaoDemo = { call };
  const inbox = BalcaoInbox.mount($('#inbox'), { request: call, title: 'Painel do dono' });
  inbox.refresh();
  const n8n = BalcaoN8n.attach({ root: $('#n8n'), call, inbox });

  /* ---------- Site do cliente ---------- */

  const EXAMPLES = {
    'oficina-pistao': [
      'Meu carro não liga desde ontem, acho que é a bateria. Preciso urgente.',
      'Quanto fica a revisão dos 60 mil km com troca de óleo? Preciso até sexta.',
      'Oi, sou eu de novo. Agora o freio está chiando, dá pra trocar as pastilhas?',
    ],
    'cromo-eletrostatica': [
      'Quero pintar um portão de 3 metros e duas grades de janela.',
      'Orçamento de lote com 200 peças em chapa, pintura epóxi, entrega em 10 dias.',
    ],
    'cantina-dona-cida': [
      'Aniversário para 30 pessoas no sábado, tem espaço reservado?',
      '10 revisões completas para carros nacionais, entrega em 2 dias úteis.',
      'Promoção imperdível! Renda extra com cripto, acesse https://a.com e https://b.com',
    ],
  };
  /** Telefone de quem já é cliente da oficina na demonstração, para o agente achar o histórico. */
  const RETURNING_PHONE = '(61) 99777-0102';
  const DOMAINS = {
    'oficina-pistao': 'oficinapistao.com.br/orcamento',
    'cromo-eletrostatica': 'cromopintura.com.br/orcamento',
    'cantina-dona-cida': 'cantinadonacida.com.br/eventos',
  };

  const form = $('#client-form');
  let business = Balcao.DEMO_BUSINESSES[0];

  function selectBusiness(slug) {
    business = Balcao.DEMO_BUSINESSES.find((b) => b.slug === slug) ?? business;
    for (const button of $('#client-tabs').children) {
      button.setAttribute('aria-pressed', String(button.dataset.slug === business.slug));
    }
    $('#client-url').textContent = DOMAINS[business.slug];
    $('#client-title').textContent = business.name;
    $('#client-promise').textContent = `${business.segment} · resposta em até ${business.responseHours} horas`;
    $('#client-service').innerHTML =
      '<option value="">Não sei / outro</option>' +
      business.services.map((s) => `<option value="${escape(s.id)}">${escape(s.name)}</option>`).join('');
    $('#client-examples').innerHTML =
      '<span>Exemplos:</span>' +
      EXAMPLES[business.slug].map((text, i) => `<button type="button" data-example="${i}">${i + 1}</button>`).join('');
    $('#client-ok').hidden = true;
  }

  $('#client-tabs').innerHTML = Balcao.DEMO_BUSINESSES.map(
    (b) => `<button type="button" data-slug="${b.slug}" aria-pressed="false">${escape(b.name)}</button>`,
  ).join('');
  $('#client-tabs').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-slug]');
    if (button) selectBusiness(button.dataset.slug);
  });
  $('#client-examples').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-example]');
    if (!button) return;
    const text = EXAMPLES[business.slug][Number(button.dataset.example)];
    form.elements.message.value = text;
    if (text.includes('sou eu de novo')) {
      form.elements.name.value = 'Eduardo Lima';
      form.elements.phone.value = RETURNING_PHONE;
      return;
    }
    if (!form.elements.name.value || form.elements.name.value === 'Eduardo Lima') form.elements.name.value = 'Você';
    if (!form.elements.phone.value || form.elements.phone.value === RETURNING_PHONE) {
      // Um número diferente por exemplo, para o mesmo texto não ser tratado como pedido repetido.
      form.elements.phone.value = `(61) 9${String(8000 + Math.floor(Math.random() * 1999)).padStart(4, '0')}-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`;
    }
  });
  selectBusiness(business.slug);

  function showErrors(errors = {}) {
    for (const field of ['name', 'phone', 'email', 'message']) {
      const message = errors[field] ?? '';
      form.querySelector(`[data-for="${field}"]`).textContent = message;
      form.elements[field].setAttribute('aria-invalid', String(Boolean(message)));
    }
    const first = ['name', 'phone', 'email', 'message'].find((f) => errors[f]);
    if (first) form.elements[first].focus();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('.send');
    button.disabled = true;
    const body = Object.fromEntries(new FormData(form));
    body.source = `https://${DOMAINS[business.slug]}`;
    try {
      const { status, data } = await call('POST', '/v1/leads', body, { 'x-balcao-key': business.publicKey });
      const ok = $('#client-ok');
      if (status === 422) {
        showErrors(data.fields);
        ok.hidden = true;
        return;
      }
      showErrors();
      ok.textContent = data.message ?? data.error;
      ok.hidden = false;
      if (status === 201) {
        form.elements.message.value = '';
        await inbox.refresh({ highlight: data.id });
        const lead = (await call('GET', `/v1/leads/${encodeURIComponent(data.id)}`)).data;
        if (lead.suspicious) n8n.notTriggered('A API marcou o pedido como suspeito, guardou e não incomodou o dono.');
        if (!lead.suspicious) {
          // Dá tempo de ver o pedido chegar no painel antes de descer para o n8n.
          setTimeout(
            () => $('#n8n').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }),
            1400,
          );
        }
      } else if (data.duplicate) {
        n8n.notTriggered(
          'Pedido repetido em menos de 10 minutos: a API devolveu o mesmo registro e não avisou de novo.',
        );
      }
    } finally {
      button.disabled = false;
    }
  });

  $('#n8n-sample').addEventListener('click', () => {
    selectBusiness('cantina-dona-cida');
    form.elements.name.value = 'Lúcia Andrade';
    form.elements.phone.value = '(61) 98123-7788';
    form.elements.email.value = 'lucia@exemplo.com';
    form.elements.message.value = `Festa de 15 anos para 80 convidados, dia ${new Date(Date.now() + 20 * 86400000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}. Vocês fazem buffet completo?`;
    form.requestSubmit();
  });

  /* ---------- Exemplos de instalação ---------- */

  const SNIPPETS = {
    html: `<span class="c">&lt;!-- No site do negócio --&gt;</span>
<span class="t">&lt;form</span> <span class="a">action</span>=<span class="v">"https://seu-balcao.com/v1/leads"</span> <span class="a">method</span>=<span class="v">"post"</span><span class="t">&gt;</span>
  <span class="t">&lt;input</span> <span class="a">type</span>=<span class="v">"hidden"</span> <span class="a">name</span>=<span class="v">"_key"</span> <span class="a">value</span>=<span class="v">"pk_minhaoficina"</span><span class="t">&gt;</span>
  <span class="t">&lt;input</span> <span class="a">type</span>=<span class="v">"hidden"</span> <span class="a">name</span>=<span class="v">"_next"</span> <span class="a">value</span>=<span class="v">"https://minhaoficina.com.br/obrigado"</span><span class="t">&gt;</span>

  <span class="t">&lt;input</span> <span class="a">name</span>=<span class="v">"name"</span> <span class="a">placeholder</span>=<span class="v">"Seu nome"</span> <span class="a">required</span><span class="t">&gt;</span>
  <span class="t">&lt;input</span> <span class="a">name</span>=<span class="v">"phone"</span> <span class="a">placeholder</span>=<span class="v">"WhatsApp com DDD"</span> <span class="a">required</span><span class="t">&gt;</span>
  <span class="t">&lt;textarea</span> <span class="a">name</span>=<span class="v">"message"</span> <span class="a">required</span><span class="t">&gt;&lt;/textarea&gt;</span>

  <span class="c">&lt;!-- Armadilha para robôs: fica escondida --&gt;</span>
  <span class="t">&lt;input</span> <span class="a">name</span>=<span class="v">"website"</span> <span class="a">style</span>=<span class="v">"display:none"</span><span class="t">&gt;</span>
  <span class="t">&lt;button&gt;</span>Pedir orçamento<span class="t">&lt;/button&gt;</span>
<span class="t">&lt;/form&gt;</span>`,
    fetch: `<span class="c">// Mesmo pedido, com resposta na própria página</span>
<span class="t">const</span> res = <span class="t">await</span> fetch(<span class="v">'https://seu-balcao.com/v1/leads'</span>, {
  <span class="a">method</span>: <span class="v">'POST'</span>,
  <span class="a">headers</span>: {
    <span class="v">'content-type'</span>: <span class="v">'application/json'</span>,
    <span class="v">'x-balcao-key'</span>: <span class="v">'pk_minhaoficina'</span>,
  },
  <span class="a">body</span>: JSON.stringify({ name, phone, message }),
});

<span class="c">// 201: { id, message }   422: { fields: { phone: "Informe um telefone com DDD..." } }</span>
<span class="t">const</span> data = <span class="t">await</span> res.json();`,
  };

  let snippet = 'html';
  const renderSnippet = () => {
    $('#snippet').innerHTML = SNIPPETS[snippet];
    for (const b of document.querySelectorAll('[data-snippet]')) {
      b.setAttribute('aria-pressed', String(b.dataset.snippet === snippet));
    }
  };
  document.querySelector('.code-bar').addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.snippet) {
      snippet = button.dataset.snippet;
      renderSnippet();
    } else if (button.id === 'copy') {
      try {
        await navigator.clipboard.writeText($('#snippet').textContent);
        button.textContent = 'Copiado';
      } catch {
        button.textContent = 'Selecione e copie';
      }
      setTimeout(() => (button.textContent = 'Copiar'), 1600);
    }
  });
  renderSnippet();
})();
