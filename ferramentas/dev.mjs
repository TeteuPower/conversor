/**
 * Sobe o ambiente de desenvolvimento inteiro num terminal só.
 *
 *     npm run dev
 *
 * São três processos, e cada um tem um motivo:
 *
 *   tipos      `tsc --build --watch`  — compila o núcleo e o servidor a cada gravação
 *   servidor   `node --watch dist`    — reinicia o servidor quando o dist muda
 *   web        `vite`                 — serve a interface com recarga a quente e repassa /api
 *
 * ---
 *
 * Por que não é mais simples do que isso.
 *
 * **Por que este script existe.** `npm run dev -w servidor & npm run dev -w web` roda os dois em
 * paralelo no shell POSIX, mas no Windows o npm chama o `cmd.exe`, e lá o `&` é separador
 * SEQUENCIAL: o servidor tomava o terminal e o Vite nunca subia. Depender de `concurrently` para
 * isto não se paga.
 *
 * **Por que o servidor não roda direto do TypeScript.** `node --experimental-strip-types
 * src/index.ts` seria bem mais curto, e falha: o Node remove os tipos mas NÃO reescreve os
 * especificadores de import. O código importa `./armazenamento.js`, que é o correto para a saída
 * compilada, e o Node sai procurando um `.js` que só existe depois de compilar. Trocar os
 * imports para `.ts` conserta o desenvolvimento e quebra o `build`. Então o caminho é compilar —
 * e o `tsc --build` é incremental, o que o deixa rápido o bastante para o laço de edição.
 *
 * **Por que compila uma vez antes de vigiar.** `node --watch` não espera o arquivo aparecer: sem
 * a compilação inicial ele sai na hora com ERR_MODULE_NOT_FOUND, e o `--watch` morre com ele.
 */

import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const NO_WINDOWS = process.platform === 'win32';

/** `npm` no Windows é `npm.cmd`; sem isto o spawn não acha o executável. */
const NPM = NO_WINDOWS ? 'npm.cmd' : 'npm';
const NPX = NO_WINDOWS ? 'npx.cmd' : 'npx';

/**
 * `shell: true` no Windows, e não por preguiça.
 *
 * Desde o Node 18.20 / 20.12, spawnar um `.cmd` ou `.bat` sem shell responde `spawn EINVAL` — foi
 * o conserto de uma falha de injeção de argumento (CVE-2024-27980), e é intencional. Como o
 * executável aqui é o `npm.cmd`, não há como fugir do shell nesta plataforma.
 *
 * O risco que a correção do Node fecha não se aplica aqui: os argumentos são literais deste
 * arquivo, e nada do que o usuário digita chega a esta linha.
 */
const COM_SHELL = NO_WINDOWS;

const ESC = '\u001b';
const RESET = `${ESC}[0m`;

const PROCESSOS = [
  {
    nome: 'tipos   ',
    cor: `${ESC}[33m`,
    cmd: NPX,
    args: ['tsc', '--build', '--watch', '--preserveWatchOutput'],
  },
  { nome: 'servidor', cor: `${ESC}[36m`, cmd: NPM, args: ['run', 'dev', '--workspace=servidor'] },
  { nome: 'web     ', cor: `${ESC}[35m`, cmd: NPM, args: ['run', 'dev', '--workspace=web'] },
];

const filhos = [];
let encerrando = false;

function prefixa(nome, cor, texto) {
  for (const linha of String(texto).split('\n')) {
    if (linha.trim()) process.stdout.write(`${cor}${nome}${RESET} | ${linha}\n`);
  }
}

function encerra(codigo) {
  if (encerrando) return;
  encerrando = true;
  for (const f of filhos) {
    if (!f.pid) continue;
    // `taskkill /t` porque no Windows matar o `npm.cmd` deixa o node filho órfão, segurando a
    // porta 7666 — e a execução seguinte falha com EADDRINUSE por um processo que ninguém vê.
    if (NO_WINDOWS) spawn('taskkill', ['/pid', String(f.pid), '/t', '/f'], { stdio: 'ignore' });
    else f.kill('SIGTERM');
  }
  setTimeout(() => process.exit(codigo), 500);
}

/* ---------- compilação inicial ---------- */

process.stdout.write('\n  Compilando o núcleo e o servidor…');
const inicial = spawnSync(NPX, ['tsc', '--build'], { cwd: RAIZ, shell: COM_SHELL, encoding: 'utf-8' });
if (inicial.status !== 0) {
  process.stdout.write(' falhou.\n\n');
  process.stdout.write(`${inicial.stdout ?? ''}${inicial.stderr ?? ''}\n`);
  process.stdout.write('  Conserte os tipos e rode de novo.\n\n');
  process.exit(inicial.status ?? 1);
}
process.stdout.write(' pronto.\n');

/* ---------- os três vigilantes ---------- */

for (const { nome, cor, cmd, args } of PROCESSOS) {
  const filho = spawn(cmd, args, { cwd: RAIZ, shell: COM_SHELL, stdio: ['ignore', 'pipe', 'pipe'] });
  filhos.push(filho);
  filho.stdout.on('data', (d) => prefixa(nome, cor, d));
  filho.stderr.on('data', (d) => prefixa(nome, cor, d));
  filho.on('exit', (codigo) => {
    if (encerrando) return;
    // Um dos três caindo derruba os outros. Deixar o Vite servindo uma interface sem servidor
    // atrás é pior que não ter nada: a tela abre e todo clique falha.
    prefixa(nome, cor, `saiu com código ${codigo}. Encerrando os outros.`);
    encerra(codigo ?? 1);
  });
  filho.on('error', (e) => {
    prefixa(nome, cor, `não subiu: ${e.message}`);
    encerra(1);
  });
}

process.on('SIGINT', () => encerra(0));
process.on('SIGTERM', () => encerra(0));

process.stdout.write(
  '\n  A interface é a do Vite, em http://localhost:7665 — é esse o endereço para abrir.\n' +
    '  Ela repassa /api ao servidor de conversão, na 7666. Ctrl+C encerra tudo.\n\n',
);
