# UTMs do Meta Ads — padrão para o Topázio

Guia para configurar os anúncios do Meta de modo que **toda** informação de origem
seja captada corretamente e ligada ao lead/conversa.

## Como a captura funciona (resumo técnico)

1. O anúncio leva para a **URL da landing page** (`/topazio/` ou `/topaziob/`).
2. O `functions/_middleware.js` lê da URL, no **primeiro acesso**, os parâmetros
   `utm_source/medium/campaign/content/term` + `fbclid` e grava na tabela `sessions`
   (cookies `_krob_sid`, `_fbp`, `_fbc` ficam 400 dias).
3. Quando o lead envia o formulário, o `/tracker` junta as UTMs da sessão ao evento
   `Lead` (Meta CAPI). No dashboard, isso vira a coluna "Origem/Campanha".

> Conclusão: **a captura depende 100% da URL do anúncio trazer os parâmetros.** Sem
> UTMs na URL, o lead aparece como "Orgânico / Direto". O `fbclid` o Meta anexa
> sozinho no clique; as UTMs **você** precisa padronizar.

## 1) Parâmetros de URL (cole no campo "Parâmetros de URL" do anúncio)

No nível do **anúncio** (Ad), em *Rastreamento → Parâmetros de URL*, use as macros
dinâmicas do Meta (preenchidas automaticamente por campanha/conjunto/anúncio):

```
utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}&utm_id={{campaign.id}}
```

Macros suportadas pelo Meta (use exatamente assim, com chaves duplas):
`{{campaign.name}}` · `{{campaign.id}}` · `{{adset.name}}` · `{{adset.id}}` ·
`{{ad.name}}` · `{{ad.id}}` · `{{site_source_name}}` · `{{placement}}`.

Regras:
- Mantenha os **valores fixos em minúsculas e sem espaços** (`utm_source=meta`,
  `utm_medium=paid_social`).
- **Não** ponha `fbclid` manualmente nem `{fbclid}` literal — o Meta adiciona o
  `fbclid` real automaticamente no clique. (Já vimos no histórico um `fbclid={fbclid}`
  não-expandido vindo de teste — remova.)
- Aponte o anúncio para a **URL de produção** (`https://www.lucianopavanbc.imb.br/topazio/`
  ou `/topaziob/`), **não** para o domínio de preview `*.pages.dev`.

### URL final esperada (exemplos)

Página A (`/topazio`):
```
https://www.lucianopavanbc.imb.br/topazio/?utm_source=meta&utm_medium=paid_social&utm_campaign=Topazio%20%5BA%5D%20Prospec&utm_content=criativo-fachada&utm_term=mulher-55&utm_id=120xxxxxxxxxx
```

Página B (`/topaziob`):
```
https://www.lucianopavanbc.imb.br/topaziob/?utm_source=meta&utm_medium=paid_social&utm_campaign=Topazio%20%5BB%5D%20Prospec&utm_content=criativo-coworking&utm_term=homem-30-55&utm_id=120xxxxxxxxxx
```

## 2) Convenção de nome de campanha: `[A]` / `[B]`

O painel separa **investimento por página** (`/api/ad-overview`) pelo **marcador no
nome da campanha** (envs `CAMPAIGN_TAG_A`/`CAMPAIGN_TAG_B`, defaults `[A]` / `[B]`).

- Campanhas que mandam tráfego para **`/topazio`** → incluir **`[A]`** no nome.
- Campanhas que mandam tráfego para **`/topaziob`** → incluir **`[B]`** no nome.

Ex.: `Topazio [A] Prospecção 25+`, `Topazio [B] Coworking 30-55`. Campanhas sem
marcador entram só no **investimento total** (não em A/B), e o custo por lead da
página fica sem base.

## 3) Checklist de verificação (depois de publicar)

1. Abra a URL final do anúncio no navegador (ou clique no anúncio em preview).
2. Confirme no D1 que a sessão gravou as UTMs (substitua o `account_id`/`database_id`):
   ```sql
   SELECT datetime(created_at,'unixepoch') t, utm_source, utm_medium, utm_campaign,
          utm_content, utm_term, CASE WHEN fbclid!='' THEN 'Y' END fbclid,
          substr(landing_url,1,70) landing
   FROM sessions ORDER BY created_at DESC LIMIT 10;
   ```
   Esperado: `utm_source=meta`, `utm_medium=paid_social`, `utm_campaign` com `[A]`/`[B]`,
   `fbclid=Y`, e `landing` apontando para `/topazio/` ou `/topaziob/` (não `pages.dev`).
3. Envie o formulário de teste e confirme o `Lead` ligado à origem:
   ```sql
   SELECT datetime(e.timestamp,'unixepoch') t, e.page, s.utm_source, s.utm_campaign,
          e.meta_response_ok
   FROM event_log e LEFT JOIN sessions s ON e.session_id=s.session_id
   WHERE e.event_name='Lead' ORDER BY e.timestamp DESC LIMIT 10;
   ```
   Esperado: `meta_response_ok=1` e a campanha/origem corretas.
4. No dashboard (`/dashboard/?key=...`), aba **Leads**: o lead aparece com a origem
   "Meta Ads" e a campanha correta; aba **Resultados**: o investimento A/B preenche
   quando o sync do Meta (`/api/sync/meta-ads`) estiver configurado.

## Observações

- O split A/B no dashboard também usa `event_log.page` ('A'/'B'), derivado da
  `landing_url` quando o campo vem vazio — por isso é importante mandar para a URL
  certa de cada página.
- GA4 só dispara se `GA4_MEASUREMENT_ID`/`GA4_API_SECRET` estiverem configurados
  (hoje não estão; é opcional).
