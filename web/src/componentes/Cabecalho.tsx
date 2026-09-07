import { useEffect, useState } from 'react';
import type { Capacidades, EngineDescrita, MotivoAusencia } from '@conversor/nucleo';

export type Tema = 'sistema' | 'claro' | 'escuro';

const CHAVE_TEMA = 'conversor.tema';

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
export function usaTema(): [Tema, (t: Tema) => void] {
  const [tema, setTema] = useState<Tema>(() => {
    try {
      const guardado = localStorage.getItem(CHAVE_TEMA);
      return guardado === 'claro' || guardado === 'escuro' ? guardado : 'sistema';
    } catch {
      return 'sistema';
    }
  });

  useEffect(() => {
    const raiz = document.documentElement;
    if (tema === 'sistema') raiz.removeAttribute('data-tema');
    else raiz.setAttribute('data-tema', tema);
    try {
      if (tema === 'sistema') localStorage.removeItem(CHAVE_TEMA);
      else localStorage.setItem(CHAVE_TEMA, tema);
    } catch {
      // Sem armazenamento, o tema vale só nesta aba. Não é motivo para avisar nada.
    }
  }, [tema]);

  return [tema, setTema];
}

interface Props {
  capacidades: Capacidades | undefined;
  tema: Tema;
  aoTrocarTema: (t: Tema) => void;
  /**
   * Substitui a linha sob o nome. Existe porque nem toda ferramenta fala com o servidor: a de
   * compressão roda inteira na página, e para ela "conectando…" seria falso — não há nada a
   * conectar.
   */
  subtitulo?: string;
}

export function Cabecalho({ capacidades, tema, aoTrocarTema, subtitulo }: Props) {
  const [enginesAbertas, setEnginesAbertas] = useState(false);

  const conversoes = capacidades
    ? new Set(capacidades.arestas.filter((a) => a.disponivel).map((a) => `${a.de}>${a.para}`)).size
    : 0;

  return (
    <header className="cabecalho">
      <div className="envelope cabecalho-envelope">
        <div className="marca">
          <Logo />
          <div>
            <h1 className="marca-nome">Conversor</h1>
            <p className="marca-sub">
              {subtitulo ?? (capacidades ? `${conversoes} conversões, nesta máquina` : 'conectando…')}
            </p>
          </div>
        </div>

        <SeletorDeFerramenta />

        <nav className="cabecalho-acoes">
          <button
            className="botao-fantasma botao-mini"
            onClick={() => setEnginesAbertas(true)}
            disabled={!capacidades}
          >
            Engines
          </button>
          <BotaoTema tema={tema} aoTrocar={aoTrocarTema} />
        </nav>
      </div>

      {enginesAbertas && capacidades && (
        <PainelDeEngines capacidades={capacidades} aoFechar={() => setEnginesAbertas(false)} />
      )}
    </header>
  );
}

/**
 * A troca entre as ferramentas.
 *
 * São âncoras de verdade (`<a href="#...">`), e não botões com `onClick`. Isso entrega de graça
 * o que um botão exigiria escrever: o histórico do navegador funciona, o botão voltar funciona,
 * abrir em nova aba funciona, e o endereço pode ser mandado para alguém. Quem lê qual está
 * aberta é o `usaFerramenta` em `Ferramentas.tsx`.
 */
function SeletorDeFerramenta() {
  const [ativa, setAtiva] = useState(() => atualDaHash());
  useEffect(() => {
    const aoTrocar = () => setAtiva(atualDaHash());
    window.addEventListener('hashchange', aoTrocar);
    return () => window.removeEventListener('hashchange', aoTrocar);
  }, []);

  return (
    <nav className="abas-ferramenta" aria-label="Ferramentas">
      <a className="aba-ferramenta" href="#converter" data-ativa={ativa === 'converter' ? 'sim' : 'nao'}>
        Converter
      </a>
      <a className="aba-ferramenta" href="#comprimir" data-ativa={ativa === 'comprimir' ? 'sim' : 'nao'}>
        Comprimir
      </a>
      <a
        className="aba-ferramenta"
        href="#remover-fundo"
        data-ativa={ativa === 'remover-fundo' ? 'sim' : 'nao'}
      >
        Remover fundo
      </a>
    </nav>
  );
}

/*
 * A leitura da hash é a mesma de `Ferramentas.tsx`, e a repetição é de propósito.
 *
 * Importar de lá fecharia um ciclo: `Ferramentas` importa `App`, que importa este arquivo. São
 * três linhas; o ciclo custaria mais que elas.
 */
function atualDaHash(): 'converter' | 'comprimir' | 'remover-fundo' {
  const h = window.location.hash.replace(/^#\/?/, '');
  return h === 'comprimir' ? 'comprimir' : h === 'remover-fundo' ? 'remover-fundo' : 'converter';
}

/**
 * O ciclo do botão é sistema → claro → escuro → sistema, e não claro ↔ escuro.
 *
 * Um botão de dois estados não tem como voltar para "seguir o sistema" depois do primeiro
 * clique, e o usuário fica preso à escolha manual para sempre — inclusive de manhã, quando o
 * sistema dele já trocou sozinho.
 */
function BotaoTema({ tema, aoTrocar }: { tema: Tema; aoTrocar: (t: Tema) => void }) {
  const proximo: Record<Tema, Tema> = { sistema: 'claro', claro: 'escuro', escuro: 'sistema' };
  const rotulo: Record<Tema, string> = {
    sistema: 'seguindo o sistema',
    claro: 'tema claro',
    escuro: 'tema escuro',
  };
  return (
    <button
      className="botao-icone"
      onClick={() => aoTrocar(proximo[tema])}
      title={`Tema: ${rotulo[tema]}. Clique para ${rotulo[proximo[tema]]}.`}
      aria-label={`Tema: ${rotulo[tema]}. Trocar para ${rotulo[proximo[tema]]}.`}
    >
      {tema === 'sistema' ? <IconeSistema /> : tema === 'claro' ? <IconeSol /> : <IconeLua />}
    </button>
  );
}

/**
 * O painel de engines.
 *
 * Ele existe porque a aplicação depende do que está instalado na máquina, e essa dependência tem
 * de ser inspecionável. Quando um destino aparece em cinza, a pergunta seguinte é "o que falta?",
 * e a resposta precisa estar em algum lugar — com o comando de instalação, não com um "consulte
 * a documentação".
 */
function PainelDeEngines({ capacidades, aoFechar }: { capacidades: Capacidades; aoFechar: () => void }) {
  useEffect(() => {
    const noTeclado = (e: KeyboardEvent) => e.key === 'Escape' && aoFechar();
    document.addEventListener('keydown', noTeclado);
    return () => document.removeEventListener('keydown', noTeclado);
  }, [aoFechar]);

  const prontas = capacidades.engines.filter((e) => e.disponivel);
  const faltando = capacidades.engines.filter((e) => !e.disponivel);

  return (
    <>
      <div className="cortina" onClick={aoFechar} aria-hidden="true" />
      <div className="painel painel-entra painel-engines" role="dialog" aria-modal="true" aria-label="Engines">
        <header className="painel-topo">
          <div>
            <h2 className="painel-titulo">Engines</h2>
            <p className="painel-sub">
              Detectadas quando o servidor subiu. Instalar algo agora aparece ao reiniciá-lo.
            </p>
          </div>
          <button className="botao-icone" onClick={aoFechar} aria-label="Fechar">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="engines-corpo">
          <h3 className="engines-secao">Prontas</h3>
          {prontas.map((e) => (
            <LinhaEngine key={e.id} engine={e} />
          ))}

          {faltando.length > 0 && (
            <>
              <h3 className="engines-secao">Ainda não</h3>
              {faltando.map((e) => (
                <LinhaEngine key={e.id} engine={e} />
              ))}
            </>
          )}
        </div>

        <footer className="painel-pe">
          <p className="engines-nota">
            O teto é de {(capacidades.limites.tamanhoMaximo / 1e9).toFixed(1).replace('.', ',')} GB
            por arquivo, {capacidades.limites.emParalelo} conversões ao mesmo tempo, e a saída se
            apaga do disco depois de {capacidades.limites.validadeSaida / 3600} h.
          </p>
        </footer>
      </div>
    </>
  );
}

function LinhaEngine({ engine }: { engine: EngineDescrita }) {
  return (
    <div className="engine" data-disponivel={engine.disponivel ? 'sim' : 'nao'}>
      <div className="engine-topo">
        <span className="engine-ponto" aria-hidden="true" />
        <strong>{engine.nome}</strong>
        {engine.onde === 'navegador' && <span className="selo-local">no navegador</span>}
        {engine.versao && <code className="engine-versao">{engine.versao}</code>}
      </div>
      <p className="engine-desc">{engine.descricao}</p>
      {engine.ausencia && <p className="engine-ausencia">{textoDaAusencia(engine.ausencia)}</p>}
    </div>
  );
}

function textoDaAusencia(a: MotivoAusencia): string {
  switch (a.tipo) {
    case 'nao-implementada':
      return `Planejada para o ${a.marco}.`;
    case 'nao-instalada':
      return a.comoInstalar;
    case 'versao-antiga':
      return `Encontrei a versão ${a.encontrada}; é preciso ${a.minima} ou mais nova.`;
    case 'sem-suporte':
      return a.detalhe;
  }
}

const Logo = () => (
  <svg width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden="true" className="logo">
    <rect x="2.5" y="2.5" width="27" height="27" rx="8" stroke="currentColor" strokeWidth="1.6" opacity="0.28" />
    <path
      d="M10 12.5h9m0 0l-3-3m3 3l-3 3"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M22 19.5h-9m0 0l3-3m-3 3l3 3"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity="0.55"
    />
  </svg>
);

const IconeSol = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.5" />
    <path
      d="M8 1.4v1.5M8 13.1v1.5M2.3 8H.8M15.2 8h-1.5M4 4l-1.1-1.1M13.1 13.1L12 12M4 12l-1.1 1.1M13.1 2.9L12 4"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
);

const IconeLua = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M13 10.2A5.6 5.6 0 015.8 3a5.8 5.8 0 107.2 7.2z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const IconeSistema = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="1.8" y="3" width="12.4" height="8.4" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
    <path d="M5.5 13.6h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);
