# Fluxo do Balcão no n8n

Um arquivo, dois gatilhos:

```
Pedido novo (webhook) → Verificar assinatura → válida? ─ não → 401
                                                 │
                                                 sim → 202 → Preparar contexto → Agente de triagem → Montar aviso
                                                                                   │  modelo: Groq · Llama 3.3     ├─ Assinar decisão → Salvar decisão na API
                                                                                   │  ferramentas:                 ├─ Avisar o dono no Telegram
                                                                                   │   historico_do_cliente        └─ Cliente deixou e-mail? → Confirmar por Gmail
                                                                                   │   servicos_do_negocio
                                                                                   └  formato: JSON com prioridade, motivo, resumo e mensagem

Seg a sáb, 9h e 15h → Buscar pedidos parados (GET /v1/leads?stale=1) → Montar cobrança → Cobrar no Telegram
```

## O agente

O nó **Agente de triagem** é um AI Agent do n8n. Ele recebe os fatos que a API já levantou (serviço, urgência, pedido
grande, se combina com o negócio) e a mensagem do cliente isolada entre marcadores. Antes de decidir, usa duas
ferramentas que chamam a própria API:

- `historico_do_cliente`: `GET /v1/leads?phone=...`, para saber se o telefone já pediu antes e se fechou.
- `servicos_do_negocio`: `GET /v1/businesses/:slug`, para conferir o que o negócio faz.

A saída passa por um _Structured Output Parser_ (prioridade, motivo, resumo e mensagem sugerida). Se o agente falhar,
o nó seguinte usa uma triagem pelas regras e o dono é avisado mesmo assim.

O `balcao-workflow.json` é gerado por `scripts/build-workflow.mjs`. Edite o script, rode `npm run build:workflow` e
reimporte. Os nós de código são testados em `test/workflow.test.ts` contra a API de verdade: a assinatura que a API
gera é aceita pelo n8n, e a que o n8n gera ao devolver a decisão do agente é aceita pela API. O teste também confere
que o agente está ligado ao modelo, às duas ferramentas e ao formato de saída.

## Como ligar (plano grátis)

1. Suba tudo com `docker compose up` na raiz do projeto e abra http://localhost:5678.
2. Importe o fluxo: menu ⋯ → _Import from file_ → `n8n/balcao-workflow.json`.
3. Crie as credenciais da tabela abaixo e selecione cada uma no nó correspondente.
4. Mande uma mensagem para o seu bot do Telegram, abra `https://api.telegram.org/bot<TOKEN>/getUpdates` e copie o
   `chat.id` para `TELEGRAM_CHAT_ID` no `.env`. Cada negócio pode ter o próprio chat em `notify.telegramChatId`.
5. Ative o fluxo (_Active_).

### Credenciais

| Nó                                            | Credencial                                              | Onde conseguir                      |
| --------------------------------------------- | ------------------------------------------------------- | ----------------------------------- |
| Groq · Llama 3.3                              | _Groq API_                                              | chave grátis em console.groq.com    |
| historico_do_cliente e Buscar pedidos parados | _Header Auth_: `Authorization` = `Bearer <ADMIN_TOKEN>` | o mesmo `BALCAO_ADMIN_TOKEN` da API |
| Avisar / Cobrar                               | _Telegram API_                                          | crie um bot com o @BotFather        |
| Confirmar por Gmail                           | _Gmail OAuth2_                                          | console do Google Cloud (grátis)    |

### Variáveis do n8n

| Variável                             | Por quê                                          |
| ------------------------------------ | ------------------------------------------------ |
| `BALCAO_N8N_SECRET`                  | o mesmo segredo da API, para as duas assinaturas |
| `BALCAO_API_URL`                     | para devolver a triagem e buscar pedidos parados |
| `TELEGRAM_CHAT_ID`                   | chat padrão dos avisos                           |
| `NODE_FUNCTION_ALLOW_BUILTIN=crypto` | libera `require('crypto')` nos nós de código     |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` | libera `$env` nos nós                            |

O `docker-compose.yml` já define todas.

## Segurança

- A API assina `timestamp.corpo` com HMAC-SHA256 e o n8n recusa assinatura errada ou com mais de 5 minutos. A volta
  (triagem) usa o mesmo esquema, conferido pela API.
- Pedidos que parecem propaganda são guardados, mas não disparam aviso.
- O texto do cliente vai para o agente isolado entre marcadores, com instrução para ignorar comandos dentro dele. As
  ferramentas só leem. O agente só sugere um
  resumo e uma mensagem; nada é enviado ao cliente sem o dono tocar no link.
- O n8n não guarda execuções bem-sucedidas (`saveDataSuccessExecution: none`): os dados ficam só no banco da API.
