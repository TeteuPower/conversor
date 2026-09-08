import {
  ENGINES_NAVEGADOR,
  FORMATOS,
  arestasNavegador,
  type Aresta,
  type Capacidades,
  type EngineDescrita,
  type Limites,
} from '@conversor/nucleo';
import { engineImagem } from './imagem.js';
import { enginePdf } from './pdf.js';
import { arestasPorVir, enginesPorVir } from './porVir.js';
import type { Deteccao, Engine } from './registro.js';

/**
 * O registro de engines do servidor. Uma engine nova entra nesta lista e mais nada muda.
 */
const ENGINES: readonly Engine[] = [engineImagem, enginePdf];

export interface Instalacao {
  readonly engines: ReadonlyMap<string, { engine: Engine; deteccao: Deteccao }>;
  readonly capacidades: Capacidades;
}

/**
 * Roda a detecção de toda engine e monta as capacidades.
 *
 * Isto acontece uma vez, ao subir o servidor, e não a cada requisição. Detectar custa: abrir
 * processo, ler versão, perguntar formato suportado. Fazer isso por requisição adicionaria
 * dezenas de milissegundos a cada clique para responder sempre a mesma coisa.
 *
 * O preço dessa escolha é que instalar o LibreOffice com o servidor no ar não é notado até
 * reiniciar. É o preço certo: o caso comum é a máquina não mudar durante a sessão, e a interface
 * diz na tela de engines que a detecção é do momento em que o servidor subiu.
 */
export async function detectaTudo(versao: string, limites: Limites): Promise<Instalacao> {
  const engines = new Map<string, { engine: Engine; deteccao: Deteccao }>();
  const descritas: EngineDescrita[] = [];
  const arestas: Aresta[] = [];

  for (const engine of ENGINES) {
    let deteccao: Deteccao;
    try {
      deteccao = await engine.detecta();
    } catch (e) {
      // Uma engine que EXPLODE ao se detectar não pode derrubar o servidor: as outras continuam
      // válidas, e esta aparece ausente com o erro à mostra.
      deteccao = {
        disponivel: false,
        ausencia: { tipo: 'sem-suporte', detalhe: `A detecção falhou: ${(e as Error).message}` },
      };
    }

    engines.set(engine.id, { engine, deteccao });
    descritas.push({
      id: engine.id,
      nome: engine.nome,
      onde: 'servidor',
      descricao: engine.descricao,
      disponivel: deteccao.disponivel,
      ...(deteccao.disponivel ? {} : { ausencia: deteccao.ausencia }),
      ...(deteccao.disponivel && deteccao.versao ? { versao: deteccao.versao } : {}),
    });
    arestas.push(...engine.arestas(deteccao));
  }

  // O que roda no navegador e o que ainda não existe entram depois, para que a aresta REAL de
  // uma engine instalada tenha precedência sobre a declaração de "por vir" do mesmo par.
  descritas.push(...ENGINES_NAVEGADOR);
  arestas.push(...arestasNavegador());
  descritas.push(...enginesPorVir());
  arestas.push(...arestasPorVir());

  return {
    engines,
    capacidades: { versao, formatos: FORMATOS, engines: descritas, arestas, limites },
  };
}
