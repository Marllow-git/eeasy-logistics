import { defineConfig } from 'vitest/config';

// Component tests render in jsdom (web §11 "Component"); the token test reads the CSS file.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
