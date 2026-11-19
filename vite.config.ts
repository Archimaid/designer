import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2023',
    chunkSizeWarningLimit: 4096,
  },
  // archimaid is linked from a sibling checkout until 0.2.0 is published, so Vite may serve files outside this root.
  server: { fs: { allow: ['.', '../Archimate for Mermaid'] } },
  // The linked checkout has its own node_modules; one Mermaid instance must register the plugin and render.
  resolve: { dedupe: ['mermaid'] },
});
