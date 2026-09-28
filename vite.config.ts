import { defineConfig } from 'vite';
import { thirdPartyNotices } from './scripts/third-party-notices';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), thirdPartyNotices()],
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
});
