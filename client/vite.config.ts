import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * Le front est servi par Vite en développement et relaie `/api` vers l'API
 * ASP.NET. Le proxy n'est pas un confort : la session vit dans un cookie
 * `SameSite=Lax`, que le navigateur refuserait d'envoyer sur une requête
 * inter-origine. En passant par le proxy, tout est vu comme une même origine —
 * exactement comme en production, où l'API sert aussi les fichiers compilés.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5080',
        changeOrigin: false,
      },
    },
  },
  build: {
    // Sortie directement dans wwwroot de l'API : `dotnet run` sert alors
    // l'interface compilée sans étape de copie.
    outDir: '../server/Cyberjet.Api/wwwroot',
    emptyOutDir: true,
    sourcemap: true,
  },
});
