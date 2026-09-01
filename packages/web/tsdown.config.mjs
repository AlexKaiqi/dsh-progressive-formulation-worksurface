import { defineConfig } from 'tsdown'

const id = '@pf-worksurface/web'

export default defineConfig({
  entry: { client: 'src/client.js' },
  outDir: '.',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  deps: {
    neverBundle: ['react'],
    alwaysBundle: dependency => dependency !== 'react',
    onlyBundle: false,
  },
  clean: false,
  dts: false,
  minify: true,
  sourcemap: false,
  treeshake: true,
  define: {
    'import.meta.env': JSON.stringify({ MODE: 'production' }),
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
