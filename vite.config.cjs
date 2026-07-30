module.exports = {
  root: process.cwd(),
  envDir: process.cwd(),
  esbuild: {
    jsx: 'automatic',
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
}
