# Balcão

Pedidos de orçamento que não esfriam. O Balcão recebe os formulários dos sites de pequenos negócios (oficinas,
restaurantes, prestadores de serviço), separa o que é urgente, avisa o dono no Telegram por um fluxo no n8n e cobra
quando o pedido fica sem resposta.

**[Abrir a demonstração](https://henriqueribeiroleonardo1.github.io/balcao/)**: mande um pedido como se fosse cliente,
veja o fluxo do n8n rodar etapa por etapa e o pedido chegar no painel do dono. A API inteira roda no seu navegador.

## O problema

Quem vive de orçamento perde cliente por demora. O formulário do site cai num e-mail que o dono abre dois dias depois,
quando o cliente já fechou com outro. O Balcão fica entre o site e o dono:

1. **Separa o pedido.** Descobre o serviço pela mensagem, classifica a urgência (pressa, prazo definido ou sem data),
   marca pedido grande, avisa quando o pedido não combina com o negócio e põe propaganda de lado, sempre explicando o
   motivo com o trecho que o cliente escreveu.
2. **Um agente decide a prioridade.** No n8n, um AI Agent (Llama 3.3 pelo Groq) consulta o histórico do cliente e os
   serviços do negócio pela própria API, decide a prioridade explicando o motivo e escreve a primeira mensagem.
   O dono recebe tudo no Telegram, com um link que abre o WhatsApp do cliente com a mensagem pronta.
3. **Confirma para o cliente** por e-mail, com o prazo de resposta do negócio.
4. **Cobra o esquecido.** Passou do prazo que o negócio definiu, o dono recebe a lista às 9h e às 15h.

## Por dentro

```
site do negócio ── POST /v1/leads ──▶ API do Balcão ── evento assinado ──▶ n8n ──▶ agente (Groq) · Telegram · Gmail
                                       │  valida, classifica,            ◀── triagem assinada ──┘
                                       │  guarda no SQLite
                                       └── painel do dono (GET/PATCH /v1/leads, /v1/stats)
```

- **TypeScript sem dependências em produção.** Servidor com `node:http`, banco com o `node:sqlite` que já vem no Node
  22, assinaturas com WebCrypto.
- **Uma API, três lugares.** `createApp` só conhece `Request` e `Response`. O Node, os testes e a demonstração no
  navegador chamam o mesmo `app.fetch()`, com armazenamento em SQLite ou em memória atrás da mesma interface.
- **HMAC nos dois sentidos.** A API assina cada evento para o n8n (`timestamp.corpo`, válido por 5 minutos) e confere a
  assinatura quando o n8n devolve a decisão do agente.
- **Funciona até sem JavaScript.** O formulário pode ser HTML puro: a API responde com um redirecionamento para a
  página de obrigado do próprio site, e só para sites autorizados.
- **Telefone brasileiro de verdade.** Aceita qualquer jeito de digitar, confere o DDD e o nono dígito e gera o link do
  WhatsApp.
- **Sem duplicados e sem spam no celular do dono.** Reenvio do mesmo pedido em 10 minutos não vira outro registro;
  pedido com cara de propaganda é guardado, mas não dispara aviso.
- **Privacidade.** Nome, telefone e mensagem nunca vão para o log. O n8n não guarda execuções.
- **O fluxo do n8n é código.** `n8n/balcao-workflow.json` é gerado por um script revisável, os nós de código são
  testados contra a API real e a CI falha se o JSON ficar desatualizado.
- **66 testes** com `node:test`, incluindo o mesmo contrato rodando nas duas implementações de armazenamento.

```
src/
  core/          classificação, validação do pedido, estatísticas, assinatura e eventos do n8n
  store/         interface de armazenamento + memória + SQLite
  http/app.ts    todas as rotas
  lib/           telefone brasileiro, HMAC, limite de requisições
  data/          negócios de demonstração
  web/           o pacote que roda no navegador
public/          site, demonstração e painel
n8n/             fluxo do n8n e passo a passo
```

## Rotas

| Rota                        | Quem usa        | O que faz                                                         |
| --------------------------- | --------------- | ----------------------------------------------------------------- |
| `POST /v1/leads`            | site do negócio | recebe um pedido (JSON ou formulário HTML), com a chave pública   |
| `GET /v1/businesses/:slug`  | site do negócio | nome e serviços, para montar o formulário                         |
| `GET /v1/leads`             | painel (token)  | lista, com filtros `business`, `status` e `stale=1`               |
| `PATCH /v1/leads/:id`       | painel (token)  | muda o status; a primeira mudança conta como primeira resposta    |
| `GET /v1/stats`             | painel (token)  | total, taxa de fechamento, tempo até a resposta, pedidos por dia  |
| `POST /v1/leads/:id/triage` | n8n (assinado)  | guarda a decisão do agente: prioridade, motivo, resumo e mensagem |

Erros vêm em português e por campo: `422 { "fields": { "phone": "Informe um telefone com DDD..." } }`.

## Rodando

Precisa do Node 22.5 ou mais novo.

```bash
npm install
npm run dev     # http://localhost:3000 (demonstração, API e painel)
npm run check   # formatação, tipos e testes
```

Com o n8n junto:

```bash
cp .env.example .env   # preencha BALCAO_ADMIN_TOKEN e BALCAO_N8N_SECRET
docker compose up      # API em :3000, n8n em :5678
```

Depois siga o [passo a passo do n8n](n8n/README.md). Para cadastrar negócios de verdade, copie
`negocios.example.json`, ajuste e aponte `BALCAO_BUSINESSES` para ele.

## Publicando de graça

- **Demonstração:** o workflow `pages.yml` publica `public/` no GitHub Pages.
- **API:** `render.yaml` sobe no plano grátis do Render. Lá o disco é apagado a cada deploy, então para um cliente de
  verdade use o `docker-compose.yml` numa VPS, onde o SQLite fica num volume.
- **n8n:** local com Docker ou no plano grátis do n8n Cloud.

## Licença

MIT · Henrique Ribeiro Leonardo
