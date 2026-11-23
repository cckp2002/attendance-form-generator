import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base './' : GitHub Pages의 어떤 저장소 이름에서도 동작하도록 상대 경로 사용
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 3000 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 60000 },
});
