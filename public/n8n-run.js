// Mostra, passo a passo, o que o fluxo do n8n faz com cada pedido da demonstração.
// O desenho vem do próprio n8n/balcao-workflow.json; os nós de código rodam com o JavaScript do fluxo;
// as ferramentas do agente e a devolução da decisão usam a API de verdade (a cópia no navegador).
// Só a decisão do modelo de linguagem é simulada, e a página diz isso.
window.BalcaoN8n = (() => {
  const escape = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, reduceMotion ? 0 : ms));

  const workflow = Balcao.WORKFLOW;
  const nodes = workflow.nodes.filter((n) => n.position[1] < 600);
  const byName = new Map(nodes.map((n) => [n.name, n]));

  /* ---------- Desenho do fluxo ---------- */

  const W = 150;
  const H = 46;

  function drawCanvas(root) {
    const xs = nodes.map((n) => n.position[0]);
    const ys = nodes.map((n) => n.position[1]);
    const minX = Math.min(...xs) - 10;
    const minY = Math.min(...ys) - 20;
    const width = Math.max(...xs) + W + 20 - minX;
    const height = Math.max(...ys) + H + 20 - minY;
    const at = (n) => ({ x: n.position[0] - minX, y: n.position[1] - minY });

    const edges = [];
    for (const [source, outputs] of Object.entries(workflow.connections)) {
      const from = byName.get(source);
      if (!from) continue;
      for (const [type, branches] of Object.entries(outputs)) {
        for (const branch of branches) {
          for (const target of branch) {
            const to = byName.get(target.node);
            if (!to) continue;
            const a = at(from);
            const b = at(to);
            if (type === 'main') {
              const x1 = a.x + W;
              const y1 = a.y + H / 2;
              const x2 = b.x;
              const y2 = b.y + H / 2;
              const mid = (x1 + x2) / 2;
              edges.push(`<path class="edge" d="M${x1} ${y1}C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}"/>`);
            } else {
              // Modelo, ferramentas e formato ficam embaixo do agente, ligados por linha tracejada.
              const x1 = a.x + W / 2;
              const y1 = a.y;
              const x2 = b.x + W / 2;
              const y2 = b.y + H;
              edges.push(`<path class="edge ai" d="M${x1} ${y1}C${x1} ${y1 - 40} ${x2} ${y2 + 40} ${x2} ${y2}"/>`);
            }
          }
        }
      }
    }

    const boxes = nodes.map((n) => {
      const { x, y } = at(n);
      const label = n.name.length > 22 ? `${n.name.slice(0, 21)}…` : n.name;
      return `<g class="node" data-node="${escape(n.name)}" transform="translate(${x} ${y})">
        <rect width="${W}" height="${H}" rx="10"/>
        <text x="${W / 2}" y="${H / 2 + 4}" text-anchor="middle">${escape(label)}</text>
        <title>${escape(n.name)} · ${escape(n.type.split('.').pop())}</title>
      </g>`;
    });

    root.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Fluxo do n8n: ${nodes.length} nós">${edges.join('')}${boxes.join('')}</svg>`;
  }

  /* ---------- Execução ---------- */

  function runCode(name, input, refs = {}) {
    const code = byName.get(name)?.parameters.jsCode;
    const $input = { first: () => ({ json: input }) };
    const $ = (ref) => ({ first: () => ({ json: refs[ref] }) });
    const $env = { TELEGRAM_CHAT_ID: 'chat-do-dono' };
    const require = () => {
      throw new Error('require indisponível no navegador');
    };
    return new Function('require', '$input', '$', '$env', code)(require, $input, $, $env)[0]?.json;
  }

  /** Só deixa passar o que o Telegram aceita com parse_mode HTML: <b>, <i> e links https. */
  function telegramHtml(text) {
    const doc = new DOMParser().parseFromString(`<div>${text}</div>`, 'text/html');
    const walk = (node) =>
      [...node.childNodes]
        .map((child) => {
          if (child.nodeType === Node.TEXT_NODE) return escape(child.textContent);
          if (child.nodeType !== Node.ELEMENT_NODE) return '';
          const inner = walk(child);
          const tag = child.tagName.toLowerCase();
          if (tag === 'b' || tag === 'i') return `<${tag}>${inner}</${tag}>`;
          const href = child.getAttribute('href') ?? '';
          if (tag === 'a' && href.startsWith('https://')) {
            return `<a href="${escape(href)}" target="_blank" rel="noopener">${inner}</a>`;
          }
          return inner;
        })
        .join('');
    return walk(doc.body.firstChild);
  }

  /**
   * Substitui o modelo de linguagem na demonstração. Segue as mesmas regras do prompt do agente,
   * usando o que as ferramentas devolveram.
   */
  function simulatedDecision(event, history) {
    const { lead, business } = event;
    const first = lead.name.split(' ')[0];
    const closed = history.filter((l) => l.status === 'fechado');
    const sentence = lead.message.split(/(?<=[.!?])\s/)[0].slice(0, 140);
    const service = business.serviceName ? ` de ${business.serviceName.toLowerCase()}` : '';

    let priority = 'média';
    let reason = 'Pedido sem data definida.';
    if (lead.mismatch) {
      priority = 'baixa';
      reason = `A mensagem não combina com os serviços da ${business.name}; vale confirmar antes de orçar.`;
    } else if (closed.length > 0) {
      priority = 'alta';
      reason = `Cliente que volta: já fechou ${closed.length === 1 ? 'um serviço' : `${closed.length} serviços`} com ${closed[0].businessName}.`;
    } else if (lead.urgency === 'alta') {
      priority = 'alta';
      reason = 'Pressa explícita na mensagem.';
    } else if (lead.bigOrder) {
      priority = 'alta';
      reason = 'Pedido grande e concreto.';
    } else if (lead.urgency === 'prazo') {
      reason = 'Tem prazo definido, mas sem pressa para hoje.';
    }

    const next = lead.mismatch
      ? 'Pode me confirmar o que você precisa? Quero ter certeza de que conseguimos ajudar.'
      : 'Podemos conversar agora para acertar os detalhes?';
    return {
      summary: sentence,
      priority,
      reason,
      suggestedReply: `Oi, ${first}! Aqui é da ${business.name}. Recebemos seu pedido${service}. ${next}`,
    };
  }

  function attach({ root, call, inbox }) {
    const canvas = root.querySelector('#n8n-canvas');
    const steps = root.querySelector('#n8n-steps');
    const telegram = root.querySelector('#n8n-telegram');
    const mail = root.querySelector('#n8n-mail');
    drawCanvas(canvas);

    const mark = (name, state) =>
      canvas.querySelector(`[data-node="${CSS.escape(name)}"]`)?.setAttribute('class', `node ${state}`);
    const resetCanvas = () => canvas.querySelectorAll('.node').forEach((n) => n.setAttribute('class', 'node'));

    function step(kind, title, text, details) {
      const li = document.createElement('li');
      li.className = `step ${kind}`;
      li.innerHTML = `<i aria-hidden="true"></i><div><b>${escape(title)}</b>${text ? `<p>${escape(text)}</p>` : ''}${
        details ? `<details><summary>ver dados</summary><pre>${escape(details)}</pre></details>` : ''
      }</div>`;
      steps.append(li);
      steps.scrollTop = steps.scrollHeight;
    }

    async function node(name, kind, title, text, details, pause = 380) {
      mark(name, 'running');
      await sleep(pause);
      step(kind, title, text, details);
      mark(name, 'done');
    }

    let running = Promise.resolve();

    async function execute(event) {
      const { lead, business } = event;
      resetCanvas();
      steps.innerHTML = '';
      telegram.innerHTML = '<span class="idle">Esperando o agente…</span>';
      mail.innerHTML = '<span class="idle">Só sai quando o cliente deixa e-mail.</span>';

      await node(
        'Pedido novo',
        'done',
        'Pedido novo',
        `Evento lead.created de ${business.name}.`,
        JSON.stringify(event, null, 2),
      );
      await node(
        'Verificar assinatura',
        'done',
        'Verificar assinatura',
        'HMAC-SHA256 do horário + corpo, enviado há menos de 5 minutos.',
      );
      mark('Assinatura válida?', 'done');
      mark('Responder 401', 'skipped');
      await node('Responder 202', 'done', 'Responder 202', 'A API recebe a confirmação e libera o cliente.', null, 200);

      const context = runCode('Preparar contexto', { event });
      await node(
        'Preparar contexto',
        'done',
        'Preparar contexto',
        'Fatos das regras + mensagem do cliente isolada.',
        context.prompt,
      );

      mark('Agente de triagem', 'running');
      mark('Groq · Llama 3.3', 'running');
      await sleep(300);

      mark('historico_do_cliente', 'running');
      const historyRes = await call('GET', `/v1/leads?phone=${encodeURIComponent(lead.phone)}`);
      const history = historyRes.data.data.filter((l) => l.id !== lead.id);
      await sleep(300);
      step(
        'tool',
        'Ferramenta historico_do_cliente',
        history.length
          ? `${history.length} pedido(s) anterior(es): ${history.map((l) => `${l.status} em ${l.businessName}`).join(', ')}.`
          : 'Primeiro pedido deste telefone.',
        JSON.stringify(
          history.map(({ name, businessName, status, createdAt }) => ({ name, businessName, status, createdAt })),
          null,
          2,
        ),
      );
      mark('historico_do_cliente', 'done');

      mark('servicos_do_negocio', 'running');
      const servicesRes = await call('GET', `/v1/businesses/${business.slug}`);
      await sleep(250);
      step('tool', 'Ferramenta servicos_do_negocio', servicesRes.data.services.map((s) => s.name).join(', '));
      mark('servicos_do_negocio', 'done');

      const decision = simulatedDecision(event, history);
      await sleep(350);
      step(
        'sim',
        `Decisão: prioridade ${decision.priority}`,
        `${decision.reason} (simulada aqui; no servidor, quem decide é o modelo.)`,
        JSON.stringify(decision, null, 2),
      );
      mark('Formato da decisão', 'done');
      mark('Groq · Llama 3.3', 'done');
      mark('Agente de triagem', 'done');

      const notice = runCode('Montar aviso', { output: decision }, { 'Preparar contexto': context });
      await node('Montar aviso', 'done', 'Montar aviso', 'Mesmo código do nó, rodando aqui.');

      mark('Assinar decisão', 'running');
      const body = JSON.stringify(notice.triage);
      const { timestamp, signature } = await Balcao.signLikeN8n(body);
      await sleep(250);
      step('done', 'Assinar decisão', `${signature.slice(0, 22)}…`);
      mark('Assinar decisão', 'done');

      mark('Salvar decisão na API', 'running');
      const saved = await Balcao.request('POST', `/v1/leads/${encodeURIComponent(lead.id)}/triage`, {
        rawBody: body,
        headers: { 'x-balcao-timestamp': timestamp, 'x-balcao-signature': signature },
      });
      step(
        saved.ok ? 'done' : 'skip',
        'Salvar decisão na API',
        saved.ok
          ? `A API conferiu a assinatura e guardou (${saved.status}). O painel já mostra.`
          : `A API recusou (${saved.status}).`,
      );
      mark('Salvar decisão na API', saved.ok ? 'done' : 'skipped');
      await inbox.refresh({ highlight: lead.id });

      await node(
        'Avisar o dono no Telegram',
        'done',
        'Avisar o dono no Telegram',
        'Mensagem com botão para responder no WhatsApp.',
        null,
        300,
      );
      telegram.innerHTML = telegramHtml(notice.telegram);

      mark('Cliente deixou e-mail?', 'done');
      if (notice.clientEmail) {
        await node(
          'Confirmar para o cliente',
          'done',
          'Confirmar para o cliente',
          `E-mail para ${notice.clientEmail}.`,
        );
        mail.innerHTML = `<b>Recebemos seu pedido · ${escape(notice.businessName)}</b>Olá, ${escape(notice.clientFirstName)}!\n\nRecebemos seu pedido de orçamento e respondemos em até ${escape(notice.responseHours)} horas, normalmente pelo WhatsApp.\n\nObrigado,\n${escape(notice.businessName)}`;
      } else {
        mark('Confirmar para o cliente', 'skipped');
        step('skip', 'Confirmar para o cliente', 'Pulado: o cliente não deixou e-mail.');
      }
    }

    Balcao.onLeadEvent((event) => {
      running = running
        .then(() => execute(event))
        .catch((error) => step('skip', 'Erro na demonstração', error.message));
    });

    return {
      /** Pedidos que não acionam o n8n (suspeito ou repetido) também aparecem, explicados. */
      notTriggered(reason) {
        resetCanvas();
        steps.innerHTML = '';
        step('skip', 'O n8n não foi acionado', reason);
      },
    };
  }

  return { attach };
})();
