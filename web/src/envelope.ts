import { montaZipPartes, type ArquivoDoZip } from '@conversor/nucleo';

/**
 * O pacote ZIP como `Blob`, para o botão de baixar.
 *
 * Duas linhas num arquivo próprio porque a divisão importa: o escritor de ZIP vive no núcleo, que
 * é compartilhado com o servidor e por isso não conhece `Blob` nem `BlobPart` — são tipos de DOM,
 * e deixá-los entrar no núcleo daria ao código de servidor acesso a `document`. Então o núcleo
 * devolve bytes e cada lado embrulha como precisa.
 *
 * O construtor de `Blob` junta as partes sem copiar, então isto não custa memória além do que as
 * partes já ocupam.
 */
export function zipComoBlob(arquivos: readonly ArquivoDoZip[]): Blob {
  return new Blob(montaZipPartes(arquivos) as BlobPart[], { type: 'application/zip' });
}
