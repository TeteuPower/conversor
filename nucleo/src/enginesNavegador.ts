import type { Aresta, EngineDescrita } from './tipos.js';

/**
 * As engines que rodam NO NAVEGADOR.
 *
 * Ficam declaradas aqui, no núcleo, porque os dois lados precisam concordar sobre elas: o
 * servidor as inclui em `/api/capacidades` para o grafo sair completo, e a interface usa a mesma
 * lista para saber que aquele trabalho não deve subir para o servidor.
 *
 * Por que o vetorizador roda no navegador, e não no servidor como as outras engines: ele é
 * JavaScript puro sobre um `Uint8ClampedArray` de pixels, sem nenhuma biblioteca nativa. Rodando
 * no navegador, o arquivo não atravessa nem o localhost, o resultado aparece sem ida e volta, e o
 * `vetorizador.html` de duplo clique continua sendo o mesmo código — uma fonte de verdade só.
 */

export const ID_VETORIZADOR = 'vetorizador';

/**
 * O que o navegador sabe decodificar sozinho, para servir de entrada ao vetorizador.
 *
 * TIFF e HEIC ficam de fora porque navegador nenhum os decodifica (Safari decodifica HEIC, os
 * outros não). Levá-los adiante exigiria decodificar no servidor e vetorizar no navegador — dois
 * saltos, com o custo escondido do usuário, que é justamente o que o grafo não faz.
 *
 * Esta lista é o OTIMISMO do servidor. A interface confirma cada uma com um decode de verdade
 * ao iniciar (ver `sondaDecodificacao` na web) e derruba o que este navegador não aguentar.
 */
export const ENTRADAS_VETORIZADOR = ['png', 'jpg', 'webp', 'gif', 'bmp', 'avif'] as const;

export const VETORIZADOR: EngineDescrita = {
  id: ID_VETORIZADOR,
  nome: 'Vetorizador',
  onde: 'navegador',
  descricao:
    'Traça o contorno da imagem e ajusta curvas de Bézier sobre ele. Decide o número de ' +
    'classes de cor pelo resíduo do modelo de pintura, não por opção, e mede a fidelidade do ' +
    'resultado rasterizando a saída de volta.',
  disponivel: true,
};

export const ENGINES_NAVEGADOR: readonly EngineDescrita[] = [VETORIZADOR];

/** As arestas que as engines de navegador oferecem. */
export function arestasNavegador(): readonly Aresta[] {
  return ENTRADAS_VETORIZADOR.map((de) => ({
    de,
    para: 'svg',
    engine: ID_VETORIZADOR,
    disponivel: true,
  }));
}

export function ehEngineDeNavegador(id: string): boolean {
  return ENGINES_NAVEGADOR.some((e) => e.id === id);
}
