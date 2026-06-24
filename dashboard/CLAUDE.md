# Page: dashboard

URL: `/dashboard/`

## Brief

- **Purpose:** Painel interno único da **TRIORE · Topázio** — agora unifica o antigo
  `/dash` aqui dentro (o `/dash` foi removido). Cobre o funil de leads do formulário
  (Meta Ads → LP → WhatsApp), investimento de mídia por página, conversas iniciadas
  por anúncio no WhatsApp (CTWA) e saúde do rastreamento. Página administrativa.
- **Audience:** gestor de tráfego (uso interno).
- **Auth:** `?key=<DASH_KEY>` na URL ou `sessionStorage.dashKey`.
- **Integrations (todas auth por `DASH_KEY`):**
  - `GET /api/leads` — leads (event_log `Lead` + sessão) + `form_opens` + `by_page`.
  - `GET /api/ad-overview` — investimento Meta e custo/lead por página (A/B).
  - `GET /api/wa-conversions` — conversões CTWA (tabela `conversions`) + status do
    `LeadSubmitted`.
  - `GET /api/health` — métricas de saúde agregadas de `event_log`.
  - `POST /api/mark-wa-sent` — marca/desmarca "WhatsApp enviado" para um lead.

## Funil

- **Meta Ads → LP `/topazio` (A) ou `/topaziob` (B) → pop-up de formulário → WhatsApp.**
  Todo CTA de WhatsApp abre o mesmo formulário em pop-up.
- **Eventos no `event_log` via `/tracker`:** `FormOpen` (abriu o pop-up) e `Lead`
  (enviou o formulário). **Desistência = FormOpen − Lead.**
- **Lado WhatsApp:** o webhook do uazapi captura o clique Click-to-WhatsApp na tabela
  `conversions` e dispara o `LeadSubmitted` (Meta CAPI). Exibido na aba WhatsApp.
- UTMs/fbclid/fbp são capturados na sessão pelo middleware e ligados ao lead.

## Abas / seções

- **Resultados:** KPIs (Leads + split A/B, Formulários abertos, Taxa de conclusão,
  % móvel) + nota de desistências; **Meta Ads — investimento por página (A/B + custo
  por lead)**; gráfico de leads por dia; tabela de leads por origem (UTM).
- **Leads:** resumo + tabela lead a lead (Lead, Página, Telefone, Origem, Campanha,
  status WhatsApp, status Meta/GA4, Quando) com filtro por origem. **Clique numa linha
  abre o modal de inspeção** com o payload exato enviado ao Meta/GA4 + resposta, e o
  botão "Sinalizar: enviei WhatsApp" (`/api/mark-wa-sent`).
- **WhatsApp:** resumo por status + tabela de conversas iniciadas por anúncio (CTWA),
  com o status do `LeadSubmitted`.
- **Saúde:** eventos reais, recuperados (ITP/adblock), bots filtrados e a quebra da
  origem do `fbp`.

## Janela de datas

- **Presets** (Hoje/7/14/30/90 dias) **+ intervalo custom** ("de … até …", dois
  `<input type="date">` + Aplicar). O estado é `{ mode:'preset', days }` **ou**
  `{ mode:'custom', from, to }`; os fetches mandam `?days=N` ou `?from=&to=`.
- Suporte a janela vem de `functions/lib/range.js` (`resolveWindow`), usado por
  `leads.js`, `ad-overview.js`, `wa-conversions.js` e `health.js`.

## Notes

- Arquivo único auto-contido (`index.html`), sem build. Tailwind CDN + Chart.js.
  **Tema claro/escuro** (toggle, `localStorage`). **Paleta TRIORE** (azul-marinho
  `--primary #1B2A4A` + dourado `--accent #B8924A`), logo `logo-triore.webp`,
  fontes Libre Baskerville / Lato.
- Origens canônicas (sem Google), classificadas pelo `utm_source`: `meta-ads`,
  `instagram-bio`, `tiktok-bio`, `remarketing`, `indicacao`, orgânico/direto.
- **NÃO** inclui painéis de e-commerce (receita/produtos/compras/atribuição por compra)
  — este funil é lead-gen por WhatsApp, sem checkout. Os endpoints `revenue/products/
  attribution/utm-breakdown/purchases` continuam no repo (parte do template de vendas),
  apenas sem consumidor neste painel.

## Change log

- 2026-06-15 — adaptado do design Renan Naves para TRIORE/Topázio.
- 2026-06-16 — removido uazapi/QualifiedLead/Purchase; medição de desistência.
- 2026-06-23 — **unificação:** absorveu o `/dash` (removido). Adicionadas seções Meta
  Ads A/B, leads enriquecidos + modal de inspeção, WhatsApp/CTWA e Saúde; seletor de
  intervalo de datas (presets + custom) via `functions/lib/range.js`; novos endpoints
  `/api/wa-conversions` e `/api/health` (auth `DASH_KEY`).
