/**
 * Números para gente ler. Fica no núcleo, e não na interface, porque o servidor também escreve
 * mensagem de erro com tamanho de arquivo dentro — e "1,4 MB" precisa sair igual nos dois lados.
 */

const UNIDADES = ['B', 'kB', 'MB', 'GB', 'TB'] as const;

/**
 * Tamanho em bytes, com potência de 1000 e não de 1024.
 *
 * A escolha é a do sistema operacional que o usuário está olhando: o Explorer do Windows e o
 * Finder mostram o arquivo em base 1000. Fosse 1024, o mesmo arquivo apareceria com dois
 * tamanhos diferentes na mesma tela, e o usuário desconfiaria — com razão — de quem estava
 * errado.
 */
export function bytes(n: number, casas?: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1000) return `${Math.round(n)} B`;
  let v = n;
  let u = 0;
  while (v >= 1000 && u < UNIDADES.length - 1) {
    v /= 1000;
    u++;
  }
  // Uma casa até 100, nenhuma acima: "8,4 MB" informa, "842,7 MB" só faz ruído.
  const c = casas ?? (v < 100 ? 1 : 0);
  return `${v.toFixed(c).replace('.', ',')} ${UNIDADES[u]}`;
}

/**
 * Duração curta, do jeito que se fala: "0,8 s", "12 s", "1 min 04 s".
 */
export function duracao(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1).replace('.', ',')} s`;
  if (s < 60) return `${Math.round(s)} s`;
  const min = Math.floor(s / 60);
  const resto = Math.round(s % 60);
  if (min < 60) return `${min} min ${String(resto).padStart(2, '0')} s`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

/**
 * Tempo restante, arredondado para grosso de propósito.
 *
 * Ninguém precisa de "faltam 47 segundos" com precisão de segundo: o número muda a cada relato
 * e o texto fica piscando. Arredondar para múltiplos de 5 acima de 10 s deixa o texto parado
 * por vários relatos seguidos, o que dá a impressão — correta — de que a estimativa é estável.
 */
export function restante(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms)) return undefined;
  const s = ms / 1000;
  if (s < 2) return 'quase pronto';
  if (s < 10) return `faltam ${Math.ceil(s)} s`;
  if (s < 60) return `faltam ${Math.ceil(s / 5) * 5} s`;
  const min = Math.ceil(s / 60);
  return min === 1 ? 'falta cerca de 1 min' : `faltam cerca de ${min} min`;
}

/**
 * Porcentagem inteira, mas sem deixar escapar um 100% antes da hora: 0,999 mostra 99%, porque
 * mostrar 100% com o arquivo ainda não pronto é exatamente o vício que o `Progresso` evita.
 */
export function percentual(fracao: number): string {
  if (!Number.isFinite(fracao)) return '0%';
  const aparado = fracao < 0 ? 0 : fracao > 1 ? 1 : fracao;
  if (aparado >= 1) return '100%';
  return `${Math.min(99, Math.floor(aparado * 100))}%`;
}

/**
 * Troca a extensão do nome mantendo o resto — inclusive ponto no meio do nome, que é comum
 * ("relatório.final.docx" tem de virar "relatório.final.pdf", não "relatório.pdf").
 */
export function trocaExtensao(nome: string, ext: string): string {
  const barra = Math.max(nome.lastIndexOf('/'), nome.lastIndexOf('\\'));
  const base = nome.slice(barra + 1);
  const ponto = base.lastIndexOf('.');
  const semExt = ponto <= 0 ? base : base.slice(0, ponto);
  return `${semExt}.${ext}`;
}

/**
 * Quanto o arquivo encolheu (ou cresceu), como texto pronto.
 *
 * Crescer não é erro e não deve parecer erro: PNG para BMP cresce sempre, e é a resposta certa
 * para quem pediu BMP. Por isso o texto é neutro nos dois sentidos.
 */
export function diferencaTamanho(antes: number, depois: number): string | undefined {
  if (!(antes > 0) || !(depois > 0)) return undefined;
  const razao = depois / antes;
  if (Math.abs(razao - 1) < 0.02) return 'praticamente do mesmo tamanho';
  return razao < 1
    ? `${Math.round((1 - razao) * 100)}% menor`
    : `${Math.round((razao - 1) * 100)}% maior`;
}
