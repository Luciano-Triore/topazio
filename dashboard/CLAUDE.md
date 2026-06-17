# Page: dashboard

URL: `/dashboard/`

## Brief

- **Purpose:** Painel interno de resultados da **TRIORE · Topázio** — leads do
  formulário da LP (Meta Ads) com atribuição UTM e medição de desistência
  (abriram o formulário × enviaram). Página administrativa, não é landing page.
  **Sem Google Ads, sem uazapi, sem QualifiedLead/Purchase.**
- **Audience:** gestor de tráfego (uso interno).
- **Auth:** `?key=<DASH_KEY>` na URL ou `sessionStorage.dashKey`.
- **Integrations:** lê via `GET /api/leads` (único endpoint, auth por DASH_KEY).
  Não grava nada (sem disparos manuais).

## Funil

- **Meta Ads → LP `/topazio` → pop-up de formulário → WhatsApp.** Todo CTA de
  WhatsApp (inclusive o flutuante) abre o **mesmo formulário em pop-up** — único
  formulário da página.
- **Dois eventos** chegam ao `event_log` via `/tracker`:
  - `FormOpen` — disparado ao abrir o pop-up (clicou no WhatsApp). Mede intenção.
  - `Lead` — disparado ao enviar o formulário (com nome/telefone hasheados p/ Meta).
  - **Desistência = FormOpen − Lead.** Todo lead enviado já é considerado
    qualificado (preencheu o formulário), por isso não há marcação manual.
- UTMs/fbclid/fbp são capturados na sessão pelo middleware e ligados ao lead.

## Abas / seções

- **Resultados:** KPIs (Leads, Formulários abertos, Taxa de conclusão = enviados ÷
  abertos, % móvel) + nota de desistências; gráfico de leads por dia; tabela de
  leads por origem (UTM).
- **Leads:** resumo (Leads, Abertos, Desistências) + tabela lead a lead
  (lead, origem, fonte/mídia, campanha, conteúdo/termo, quando) com filtro por origem.

## Notes

- Arquivo único auto-contido (`index.html`); sem build. Tailwind CDN + Chart.js.
  **Tema claro/escuro** (toggle, `localStorage`). **Paleta TRIORE** (azul-marinho
  `--primary #1B2A4A` + dourado `--accent #B8924A`), logo `logo-triore.webp`
  (copiado de `topazio/fotos/`), fontes Libre Baskerville / Lato.
- **Toda a UI vem de um único fetch** a `/api/leads?key=&days=&limit=500`. KPIs,
  gráfico (bucket por dia no cliente), origens e a tabela lead a lead são
  calculados no front a partir da lista + do campo `form_opens` do retorno.
- **Janela móvel:** presets Hoje/7/14/30/90 dias (`/api/leads` filtra por `days`
  trailing; sem range de data arbitrário).
- Origens canônicas (sem Google), classificadas pelo `utm_source`: `meta-ads`,
  `instagram-bio`, `tiktok-bio`, `remarketing`, `indicacao`, orgânico/direto (sem UTM).
- A lista mostra e-mail (se coletado), dispositivo, origem, campanha, quando. O
  formulário do Topázio coleta nome/telefone (hasheados p/ Meta, não persistidos
  em claro); o contato real acontece no WhatsApp.

## Endpoints e tabelas

- Leitura: `functions/api/leads.js` (event_log `Lead` LEFT JOIN sessions; retorna
  UTMs + `form_opens` = contagem de eventos `FormOpen` no período). Tabelas:
  `event_log`, `sessions`.

## Change log

- 2026-06-15 — adaptado do design Renan Naves para TRIORE/Topázio (sem Google Ads,
  logo TRIORE, paleta azul+dourado, religado a `/api/leads`).
- 2026-06-16 — removido uazapi/QualifiedLead/Purchase (todo lead do formulário já é
  qualificado); adicionada medição de desistência via evento `FormOpen` (abertos ×
  enviados); simplificado para 2 abas (Resultados, Leads).
