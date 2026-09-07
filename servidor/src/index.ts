import { availableParallelism, cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { bytes, type Limites } from '@conversor/nucleo';
import { Armazenamento } from './armazenamento.js';
import { detectaTudo } from './engines/todas.js';
import { Fila } from './fila.js';
import { montaServidor, recolhePendentes } from './http.js';

const VERSAO = '0.1.0';

/**
 * Teto de tamanho: 2 GB.
 *
 * O Convertio para em 1 GB por não ser de graça mandar arquivo grande pela internet. Aqui o
 * arquivo não vai a lugar nenhum, então o teto tem outro dono: ele existe para o servidor não
 * tentar decodificar algo que não cabe na memória e derrubar a máquina junto. 2 GB dá folga para
 * vídeo e para digitalização, e ainda protege do arquivo escolhido por engano.
 *
 * 2 000 000 000 e não 2 × 1024³: o tamanho é mostrado em base 1000, como o Explorer faz (ver
 * `bytes` no núcleo). Com o valor binário, a tela diria "2,1 GB" para um teto anunciado como
 * 2 GB, e o usuário teria razão em achar que um dos dois números está errado.
 */
const TAMANHO_MAXIMO = 2_000_000_000;

/**
 * Quanto tempo a saída fica no disco: 2 horas.
 *
 * O Convertio guarda 24 h porque o arquivo está no servidor dele e o usuário pode voltar de
 * outro computador. Aqui o arquivo está na própria máquina, e a saída que interessa o usuário já
 * baixou — o que fica é lixo. 2 horas cobrem com sobra "converti, fui almoçar, voltei e baixei",
 * sem deixar arquivo pessoal no temporário até o próximo reinício.
 */
const VALIDADE_SAIDA = 2 * 60 * 60;

const INTERVALO_VARREDURA = 5 * 60 * 1000;

/**
 * Quantas conversões ao mesmo tempo: núcleos menos um, com teto de 4.
 *
 * O "menos um" é o ponto: isto roda na máquina em que a pessoa está trabalhando. Ocupar todos os
 * núcleos faria a conversão terminar um pouco antes e o resto do computador engasgar enquanto
 * isso — troca ruim quando quem espera está olhando a tela.
 *
 * O teto de 4 é por memória, não por CPU: libvips trabalha em faixas, mas cada conversão em voo
 * ainda tem os seus buffers, e quatro AVIF grandes simultâneos já pesam.
 */
function emParalelo(): number {
  const nucleos = typeof availableParallelism === 'function' ? availableParallelism() : cpus().length;
  return Math.max(1, Math.min(4, nucleos - 1));
}

/** A porta pode ser trocada por variável de ambiente, para o caso de 7666 estar ocupada. */
const PORTA = Number(process.env.CONVERSOR_PORTA ?? 7666);

async function principal(): Promise<void> {
  const aqui = dirname(fileURLToPath(import.meta.url));
  // Compilado, isto é servidor/dist; em desenvolvimento, servidor/src. Nos dois casos a
  // interface compilada fica em web/dist, duas pastas acima.
  const web = resolve(aqui, '..', '..', 'web', 'dist');
  const temWeb = existsSync(join(web, 'index.html'));

  const limites: Limites = {
    tamanhoMaximo: TAMANHO_MAXIMO,
    emParalelo: emParalelo(),
    validadeSaida: VALIDADE_SAIDA,
  };

  const instalacao = await detectaTudo(VERSAO, limites);
  const armazenamento = await Armazenamento.abre(VALIDADE_SAIDA);
  const fila = new Fila(limites.emParalelo, (msg) => console.log(`  ${msg}`));

  const { servidor } = montaServidor(instalacao, armazenamento, fila, {
    porta: PORTA,
    ...(temWeb ? { web } : {}),
    tamanhoMaximo: TAMANHO_MAXIMO,
  });

  const paraVarredura = armazenamento.varreDeVezEmQuando(INTERVALO_VARREDURA, (n) =>
    console.log(`  varredura: ${n} trabalho(s) expirado(s) apagado(s)`),
  );
  const varreduraPendentes = setInterval(() => recolhePendentes(30 * 60 * 1000), INTERVALO_VARREDURA);
  varreduraPendentes.unref?.();

  // Uma varredura já na subida recolhe o que sobrou de uma execução interrompida antes.
  const sobra = await armazenamento.varre();

  // `127.0.0.1` explícito, e não `0.0.0.0`: sem isto o conversor ficaria visível para a rede
  // local, e o arquivo que alguém está convertendo é assunto dele.
  servidor.listen(PORTA, '127.0.0.1', () => {
    anuncia(instalacao, limites, temWeb, sobra);
  });

  servidor.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') {
      console.error(
        `\n  A porta ${PORTA} já está ocupada.\n` +
          `  Rode com outra: CONVERSOR_PORTA=7667 npm start\n`,
      );
      process.exit(1);
    }
    throw e;
  });

  const desliga = () => {
    console.log('\n  Encerrando.');
    paraVarredura();
    clearInterval(varreduraPendentes);
    servidor.close(() => process.exit(0));
    // Se alguma conexão pendurada segurar o fechamento, sai de todo jeito em 2 s.
    setTimeout(() => process.exit(0), 2000).unref?.();
  };
  process.on('SIGINT', desliga);
  process.on('SIGTERM', desliga);
}

function anuncia(
  instalacao: Awaited<ReturnType<typeof detectaTudo>>,
  limites: Limites,
  temWeb: boolean,
  sobra: number,
): void {
  const { engines, arestas } = instalacao.capacidades;
  const disponiveis = engines.filter((e) => e.disponivel);
  const conversoes = new Set(arestas.filter((a) => a.disponivel).map((a) => `${a.de}>${a.para}`));

  console.log(`\n  Conversor ${VERSAO} — http://localhost:${PORTA}\n`);
  console.log(`  ${conversoes.size} conversões disponíveis agora.`);
  console.log(`  Até ${limites.emParalelo} ao mesmo tempo, teto de ${bytes(limites.tamanhoMaximo)} por arquivo.`);
  console.log(`  A saída se apaga sozinha depois de ${limites.validadeSaida / 3600} h.`);
  if (sobra > 0) console.log(`  Recolhi ${sobra} trabalho(s) que sobraram da execução anterior.`);

  console.log('\n  Engines prontas:');
  for (const e of disponiveis) {
    console.log(`    ${e.nome}${e.versao ? ` — ${e.versao}` : ''}${e.onde === 'navegador' ? ' (no navegador)' : ''}`);
  }
  const faltando = engines.filter((e) => !e.disponivel);
  if (faltando.length) {
    console.log('\n  Ainda não:');
    for (const e of faltando) {
      const a = e.ausencia;
      const por =
        a?.tipo === 'nao-implementada'
          ? a.marco
          : a?.tipo === 'nao-instalada'
            ? 'não instalada'
            : a?.tipo === 'versao-antiga'
              ? `versão ${a.encontrada}, precisa de ${a.minima}`
              : (a?.detalhe ?? '');
      console.log(`    ${e.nome} — ${por}`);
    }
  }

  if (!temWeb) {
    console.log(
      '\n  Sem interface compilada em web/dist. Para desenvolver, rode `npm run dev` na raiz e\n' +
        '  abra o endereço que o Vite mostrar. Para usar, rode `npm run build` antes.',
    );
  }
  console.log('\n  Nada sai desta máquina. Ctrl+C encerra.\n');
}

await principal();
