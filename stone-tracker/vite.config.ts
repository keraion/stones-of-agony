import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// When deploying to GitHub Pages for a repository site, set VITE_BASE
// (via environment or CI) to the repository path (e.g. '/stones-of-agony/').
const BASE = process.env.VITE_BASE || '/';

export default defineConfig({
  base: BASE,
  plugins: [react()],
});
