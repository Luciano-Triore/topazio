# Page: dashboard

URL: `/dashboard/`

## Brief

- **Purpose:** Painel interno de resultados da **TRIORE · Topázio** — leads do
  formulário da LP (Meta Ads) com atribuição UTM + estrutura de WhatsApp/comercial
  (lista de leads + marcação manual de **Qualificado**). Página administrativa, não é
  landing page. **Sem Google Ads.**
- **Audience:** gestor de tráfego + atendente do comercial (uso interno).
- **Auth:** `?key=<DASH_KEY>` na URL ou `sessionStorage.dashKey`.
- **Integrations:** lê via `GET /api/leads` (único endpoint, auth por DASH_KEY) e grava
  via `POST /api/fire-qualified-lead-web`. Nenhum pixel/tracker dispara aqui.

## Funil (modelo desta LP — com formulário)

- **Meta Ads → LP `/topazio` → pop-up de formulário → WhatsApp.** Todo CTA de WhatsApp
  (inclusive o botão flutuante) abre o **mesmo formulário em pop-up** — é o único
  formulário da página. O envio dispara o evento `Lead` (pixel + CAPI website via
  `/tracker`) e então redireciona ao WhatsApp (texto com token `#ref`).
  UTMs/fbclid/fbp/`_krob_eid` são capturados na sessão pelo middleware.
- **Qualificado é MANUAL:** a atendente marca na lista. Ao marcar, dispara
  `QualifiedLead` (Meta CAPI, action_source `website`) atribuído pelo `fbp/fbc/external_id`
  da sessão de origem do lead — ver `functions/api/fire-qualified-lead-web.js`.
- Acompanhamento da conversa em si acontece no WhatsApp (uazapi). O texto pré-preenchido
  do `wa.me` carrega um token `#xxxxxxxx` (primeiros 8 chars do `_krob_eid`) que o webhook
  do uazapi grava em `message_content` — base para ligar a conversa ao lead no futuro.

## Abas / seções

- **Resultados:** Leads, Leads qualificados, Taxa de qualificação, % móvel; gráfico de
  leads por dia; tabela de leads por origem (UTM).
- **WhatsApp / Comercial:** funil (leads / qualificados / taxa) + lista de leads com botão
  **Qualificar** (confirmação → dispara QualifiedLead). Filtro Todos/Novos/Qualificados.
- **Atribuição (UTM):** resumo por origem + tabela lead a lead (fonte/mídia, campanha,
  conteúdo/termo, status). Origens canônicas (sem Google): `meta-ads`, `instagram-bio`,
  `tiktok-bio`, `remarketing`, `indicacao`, orgânico/direto (sem UTM).

## Notes

- Arquivo único auto-contido (`index.html`); sem build. Tailwind CDN + Chart.js. **Tema
  claro/escuro** (toggle, `localStorage`). **Paleta TRIORE** (azul-marinho `--primary
  #1B2A4A` + dourado `--accent #B8924A`/`--secondary #D4AD6E`), logo `logo-triore.webp`
  (hexágono, copiado de `topazio/fotos/`), fontes Libre Baskerville / Lato.
- **Toda a UI é alimentada por um único fetch** a `/api/leads?key=&days=&limit=500`. KPIs,
  gráfico (bucket por dia no cliente), origens e atribuição são calculados no front a partir
  dessa lista — sem depender de endpoints que não existem neste repo.
- **Janela móvel:** presets Hoje/7/14/30/90 dias (o `/api/leads` filtra por `days`
  trailing; não há range de data arbitrário).
- A lista de leads mostra e-mail (se coletado), dispositivo, origem, campanha, quando e
  status. O formulário do Topázio coleta nome/telefone (hasheados para o Meta, não
  persistidos em claro) — o contato real é feito pelo WhatsApp.

## Endpoints e tabelas

- Leitura: `functions/api/leads.js` (event_log `Lead` LEFT JOIN sessions; retorna UTMs +
  `qualified_lead_status`). Escrita: `functions/api/fire-qualified-lead-web.js`
  (QualifiedLead website-CAPI por `META_PIXEL_ID`/`META_ACCESS_TOKEN`).
- Tabelas: `event_log` (+ colunas `qualified_lead_*` da migration `0016`), `sessions`.

## Change log

- 2026-06-15 — adaptado do design Renan Naves para TRIORE/Topázio: removido Google Ads,
  logo TRIORE, paleta azul+dourado, religado ao backend real (`/api/leads` +
  `/api/fire-qualified-lead-web`), comercial só com **Qualificado**.
