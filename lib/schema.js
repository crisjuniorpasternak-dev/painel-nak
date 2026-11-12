// Estrutura do banco. Aplicada a cada sincronização e no primeiro login após uma atualização (só cria o que falta).
import { q } from './db.js';

export const SCHEMA = String.raw`-- Banco do Painel Comercial NAK (Postgres). Cópia somente leitura do CRM DataCrazy.
-- Pode rodar quantas vezes quiser: só cria o que ainda não existe.

CREATE TABLE IF NOT EXISTS pipelines (
  id          text PRIMARY KEY,
  nome        text NOT NULL,
  atualizado  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS etapas (
  id          text PRIMARY KEY,
  pipeline_id text NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  nome        text NOT NULL,
  indice      integer NOT NULL DEFAULT 0,
  cor         text,
  atualizado  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS etapas_pipeline ON etapas (pipeline_id);

CREATE TABLE IF NOT EXISTS vendedores (
  id          text PRIMARY KEY,
  nome        text NOT NULL,
  email       text,
  atualizado  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leads (
  id          text PRIMARY KEY,
  nome        text,
  documento   text,            -- CPF/CNPJ (taxId)
  empresa     text,
  telefone    text,
  email       text,
  cidade      text,
  uf          text,
  criado_em   timestamptz,
  atualizado  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS negocios (
  id            text PRIMARY KEY,
  codigo        integer,
  etapa_id      text,          -- sem FK: a etapa pode ter sido apagada no CRM
  lead_id       text,
  vendedor_id   text,
  status        text,          -- won | in_process | lost
  total         numeric(14,2) NOT NULL DEFAULT 0,
  desconto      numeric(14,2),
  criado_em     timestamptz,
  movido_em     timestamptz,
  status_em     timestamptz,
  external_id   text,          -- número do pedido/orçamento na Omie
  qtd_produtos  integer,
  visto_em      timestamptz NOT NULL DEFAULT now()  -- última sincronização que trouxe o negócio
);
CREATE INDEX IF NOT EXISTS negocios_etapa ON negocios (etapa_id);
CREATE INDEX IF NOT EXISTS negocios_movido ON negocios (movido_em);
CREATE INDEX IF NOT EXISTS negocios_lead ON negocios (lead_id);

CREATE TABLE IF NOT EXISTS negocio_itens (
  negocio_id  text NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  ordem       integer NOT NULL,
  produto_id  text,
  sku         text,
  produto     text,
  quantidade  numeric(14,3) NOT NULL DEFAULT 0,
  preco       numeric(14,2),
  total       numeric(14,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (negocio_id, ordem)
);
CREATE INDEX IF NOT EXISTS itens_produto ON negocio_itens (produto_id);

CREATE TABLE IF NOT EXISTS sincronizacoes (
  id          bigserial PRIMARY KEY,
  tipo        text NOT NULL,        -- incremental | completa
  inicio      timestamptz NOT NULL DEFAULT now(),
  fim         timestamptz,
  ok          boolean,
  negocios    integer,
  leads       integer,
  removidos   integer,
  erro        text
);

-- Acessos ao painel. perfil: admin (tudo, inclusive acessos), supervisor (vê tudo, cuida dos acessos de vendedores),
-- vendedor (vê só os negócios em que é o responsável no CRM: vendedor_id = id do atendente no DataCrazy).
CREATE TABLE IF NOT EXISTS usuarios (
  id             bigserial PRIMARY KEY,
  email          text NOT NULL UNIQUE,
  nome           text NOT NULL,
  senha_hash     text NOT NULL,
  perfil         text NOT NULL CHECK (perfil IN ('admin', 'supervisor', 'vendedor')),
  vendedor_id    text,
  ativo          boolean NOT NULL DEFAULT true,
  sessao_versao  integer NOT NULL DEFAULT 1,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  criado_por     text,
  ultimo_acesso  timestamptz
);

-- Visão usada pelo painel: um negócio por linha, com os nomes já resolvidos.
CREATE OR REPLACE VIEW vw_negocios AS
SELECT n.id, n.codigo, n.status, n.total, n.criado_em, n.movido_em, n.external_id, n.qtd_produtos,
       e.id AS etapa_id, e.nome AS etapa, e.indice AS etapa_indice,
       p.id AS pipeline_id, p.nome AS pipeline,
       n.lead_id, coalesce(nullif(trim(l.nome), ''), nullif(trim(l.empresa), ''), 'Sem nome') AS cliente, l.documento, l.cidade, l.uf,
       n.vendedor_id, coalesce(v.nome, 'Sem vendedor') AS vendedor, v.email AS vendedor_email
FROM negocios n
LEFT JOIN etapas e ON e.id = n.etapa_id
LEFT JOIN pipelines p ON p.id = e.pipeline_id
LEFT JOIN leads l ON l.id = n.lead_id
LEFT JOIN vendedores v ON v.id = n.vendedor_id;
`;

export async function aplicarSchema() {
  const comandos = SCHEMA.split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean);
  for (const c of comandos) await q(c);
}

let pronto = null;
/** Aplica a estrutura uma vez por instância, só se ainda faltar alguma tabela nova. */
export function garantirSchema() {
  if (!pronto) {
    pronto = q("SELECT to_regclass('public.usuarios') AS t")
      .then(([r]) => (r && r.t ? null : aplicarSchema()))
      .catch((e) => { pronto = null; throw e; });
  }
  return pronto;
}
