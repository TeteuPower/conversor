import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const raiz = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Os módulos do vetorizador são importados DIRETO da pasta dele, sem cópia.
      //
      // Isto é o que mantém uma fonte de verdade só. O `vetorizador.html` de duplo clique
      // continua sendo gerado pelo `montar.py` a partir dos mesmos arquivos, e uma correção no
      // traçado de contorno chega aos dois entregáveis no mesmo commit. Copiar os módulos para
      // dentro de web/src pareceria mais arrumado e criaria a pior espécie de dívida: duas
      // cópias do mesmo algoritmo, divergindo devagar.
      '@vetorizador': fileURLToPath(new URL('../vetorizador/fonte', import.meta.url)),
    },
  },
  server: {
    port: 7665,
    // Em desenvolvimento o Vite serve a interface e repassa a API ao servidor de conversão.
    // Assim o navegador vê uma origem só, e o `Host: localhost` que o servidor exige chega
    // certo — sem isto, a trava contra religação de DNS barraria o próprio Vite.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:7666',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // O núcleo do vetorizador é JavaScript de laço apertado sobre arrays de pixel. O
    // minificador não deve reorganizar aritmética: `esbuild` já é conservador nisso, e a
    // legibilidade do stack trace de um bug de geometria vale mais que os poucos kB de
    // diferença para um minificador agressivo.
    minify: 'esbuild',
    sourcemap: true,
    chunkSizeWarningLimit: 700,
  },
  worker: {
    format: 'es',
  },
});
