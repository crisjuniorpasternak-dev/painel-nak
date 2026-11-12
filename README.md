# Painel Comercial NAK

Dashboard de vendas da NAK ligado à API do CRM DataCrazy, com login por senha.

## Como funciona

```
DataCrazy (API, só leitura)
   │  /api/sync  ← Vercel Cron 1x/dia (completa) + GitHub Actions de hora em hora (incremental)
   ▼
Postgres (Neon)  pipelines · etapas · vendedores · leads · negocios · negocio_itens · sincronizacoes
   │  /api/dados (precisa de login)
   ▼
public/index.html  abas Visão geral, Vendedores, Curva ABC, Produtos, Carteira de clientes, Funil e orçamentos
```

- **O CRM nunca é alterado.** A sincronização só faz GET na API do DataCrazy.
- **Completa** (todo dia às 5h30 de Brasília): relê negócios e leads por janelas mensais e tira do banco os negócios que não existem mais no CRM.
- **Incremental** (de hora em hora, das 7h às 20h, de segunda a sábado): relê os negócios movidos ou criados nos últimos 3 dias e busca leads que faltam.
- Respeita o limite da API (60 requisições por minuto por rota) e espera quando recebe 429.
- O histórico de cada sincronização fica na tabela `sincronizacoes` (com o erro, se houver).

## Colocar no ar (uma vez)

1. **Vercel → Add New → Project**, importe este repositório. Framework: *Other*. Não precisa de comando de build.
2. **Storage → Create Database → Neon (Postgres)** e ligue ao projeto. Isso cria `DATABASE_URL`.
3. **Settings → Environment Variables**: preencha as variáveis do arquivo `.env.example` (`DATACRAZY_TOKEN`, `PAINEL_SENHA`, `SESSAO_SEGREDO`, `CRON_SECRET`).
4. **Deployments → Redeploy** para as variáveis valerem.
5. Rode a primeira carga completa (cria as tabelas sozinha):
   ```
   curl -H "Authorization: Bearer <CRON_SECRET>" "https://<seu-painel>.vercel.app/api/sync?tipo=completa"
   ```
6. **GitHub → Settings → Secrets and variables → Actions**: crie `PAINEL_URL` (endereço do painel) e `CRON_SECRET` (o mesmo da Vercel) para ligar a sincronização de hora em hora.

Abra o endereço do painel, digite a senha e pronto.

## Desenvolvimento

```
npm install
npm test        # banco em memória (PGlite) + API DataCrazy simulada com dados anônimos
```
