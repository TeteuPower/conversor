/**
 * O protocolo entre a página e o worker do codificador.
 *
 * Isto mora num módulo à parte, e não dentro do worker, por um motivo prático: o worker instala
 * `self.onmessage` ao ser carregado. Se a página importasse dele qualquer coisa de RUNTIME — e
 * `MIME` é runtime, não é só tipo — o módulo inteiro rodaria também na thread principal e no
 * teste, onde `self` não existe. Tipos podem atravessar (somem na compilação); valores, não.
 */

export type FormatoSaida = 'webp' | 'jpeg' | 'png';

export const MIME: Readonly<Record<FormatoSaida, string>> = {
  webp: 'image/webp',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

export type PedidoAoWorker =
  | { tipo: 'sonda' }
  | { tipo: 'carrega'; arquivo: Blob }
  | {
      tipo: 'codifica';
      id: number;
      formato: FormatoSaida;
      /** 1..100. Ignorado por PNG, que não tem perda. */
      qualidade: number;
      /** Quando ausente, o tamanho original. */
      largura?: number;
    };

export type RespostaDoWorker =
  | { tipo: 'sonda'; suportados: FormatoSaida[]; recusados: FormatoSaida[] }
  | { tipo: 'carregado'; largura: number; altura: number }
  | {
      tipo: 'pronto';
      id: number;
      dados: ArrayBuffer;
      mime: string;
      tamanho: number;
      largura: number;
      altura: number;
      ms: number;
    }
  | { tipo: 'erro'; id?: number; mensagem: string };
