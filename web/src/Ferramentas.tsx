import { useEffect, useState } from 'react';
import { App } from './App.js';
import { Comprimir } from './comprimir/Comprimir.js';
import { RemoverFundo } from './fundo/RemoverFundo.js';

export type Ferramenta = 'converter' | 'comprimir' | 'remover-fundo';

/**
 * Qual ferramenta está aberta, decidido pelo hash da URL.
 *
 * O hash, e não um estado em memória, por três razões concretas:
 *
 * - **O F5 não perde o lugar.** Quem estava comprimindo e recarregou volta comprimindo.
 * - **O botão voltar do navegador funciona**, sem nenhum código nosso para isso.
 * - **Dá para mandar o link.** `#comprimir` abre direto na ferramenta certa.
 *
 * E o principal: nada disso obriga o conversor a saber que existe outra ferramenta. O `App` não
 * recebe nenhuma propriedade nova e não muda uma linha — ele só deixou de ser a raiz.
 */
export function usaFerramenta(): Ferramenta {
  const [ferramenta, setFerramenta] = useState<Ferramenta>(daHash);
  useEffect(() => {
    const aoTrocar = () => setFerramenta(daHash());
    window.addEventListener('hashchange', aoTrocar);
    return () => window.removeEventListener('hashchange', aoTrocar);
  }, []);
  return ferramenta;
}

function daHash(): Ferramenta {
  const h = window.location.hash.replace(/^#\/?/, '');
  return h === 'comprimir' ? 'comprimir' : h === 'remover-fundo' ? 'remover-fundo' : 'converter';
}

export function Ferramentas() {
  const ferramenta = usaFerramenta();
  if (ferramenta === 'comprimir') return <Comprimir />;
  if (ferramenta === 'remover-fundo') return <RemoverFundo />;
  return <App />;
}
