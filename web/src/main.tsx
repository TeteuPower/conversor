import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './estilo/base.css';
import './estilo/movimento.css';
import './estilo/componentes.css';

const raiz = document.getElementById('raiz');
if (!raiz) throw new Error('Não achei #raiz no index.html.');

createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
