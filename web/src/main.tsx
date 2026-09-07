import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Ferramentas } from './Ferramentas.js';
import './estilo/base.css';
import './estilo/movimento.css';
import './estilo/componentes.css';
import './estilo/comprimir.css';

const raiz = document.getElementById('raiz');
if (!raiz) throw new Error('Não achei #raiz no index.html.');

createRoot(raiz).render(
  <StrictMode>
    <Ferramentas />
  </StrictMode>,
);
