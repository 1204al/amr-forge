import { defineConfig } from 'vite';
import tailwind from '@tailwindcss/vite';

const proxy = {
  '/isaac-api': { target: 'http://127.0.0.1:8765', rewrite: (path: string) => path.replace(/^\/isaac-api/, '') },
};

export default defineConfig({ plugins: [tailwind()], server: { proxy }, preview: { proxy } });
