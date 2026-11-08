import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Los tests de integración comparten emulador y lo limpian entre casos: un archivo a la vez.
    fileParallelism: false,
    testTimeout: 20000,
    coverage: { provider: 'v8', reporter: ['text', 'lcov'], reportsDirectory: 'coverage', include: ['src/**'], exclude: ['src/index.ts', 'src/openapi.json'] },
  },
});
