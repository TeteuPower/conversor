import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Os testes moram ao lado do que testam, com sufixo .teste.ts — em português, como o resto
    // do código. O padrão do vitest (.test.ts / .spec.ts) não os acharia.
    include: ['src/**/*.teste.ts'],
  },
});
