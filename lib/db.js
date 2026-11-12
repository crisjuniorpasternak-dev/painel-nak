// Acesso ao Postgres (Neon, criado pela integração da Vercel, que preenche DATABASE_URL).
import { neon } from '@neondatabase/serverless';

let executor = null;

/** Troca o executor de SQL (usado nos testes com um Postgres em memória). */
export function definirExecutor(fn) {
  executor = fn;
}

function padrao() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error('DATABASE_URL não configurada. Ligue um banco Neon ao projeto na Vercel (Storage → Neon).');
  const sql = neon(url);
  return (texto, params) => sql.query(texto, params);
}

/** Executa um comando e devolve as linhas. */
export async function q(texto, params = []) {
  if (!executor) executor = padrao();
  return executor(texto, params);
}
