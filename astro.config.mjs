// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://chrisputer.tech',
  output: 'server',
  adapter: cloudflare(),
  vite: {
    plugins: [tailwindcss()],
  },
});