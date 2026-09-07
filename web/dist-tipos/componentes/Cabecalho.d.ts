import type { Capacidades } from '@conversor/nucleo';
export type Tema = 'sistema' | 'claro' | 'escuro';
/**
 * O tema, guardado no armazenamento local.
 *
 * O padrão é `sistema`, e é o certo: quem configurou o computador em escuro já disse o que
 * prefere, e uma aplicação que ignora isso obriga a repetir a escolha. O botão existe para quem
 * quer o contrário do sistema neste momento — ler um documento claro à noite, por exemplo.
 *
 * A leitura é protegida por try/catch porque o armazenamento local LANÇA em janela privada de
 * alguns navegadores, em vez de devolver vazio. Sem a proteção, a aplicação inteira não abriria
 * por causa da preferência de cor.
 */
export declare function usaTema(): [Tema, (t: Tema) => void];
interface Props {
    capacidades: Capacidades | undefined;
    tema: Tema;
    aoTrocarTema: (t: Tema) => void;
}
export declare function Cabecalho({ capacidades, tema, aoTrocarTema }: Props): import("react").JSX.Element;
export {};
//# sourceMappingURL=Cabecalho.d.ts.map