import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

function formatBuildTimestampNY(): string {
  const now = new Date();
  const timePart = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(now);
  const datePart = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  }).format(now);
  return `${timePart} - ${datePart}`;
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __BUILD_TIMESTAMP__: JSON.stringify(formatBuildTimestampNY()),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4580',
        changeOrigin: true,
      },
    },
  },
});
