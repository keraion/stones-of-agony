const fs = require('fs')
const path = require('path')

const distDir = path.resolve(__dirname, '..', 'dist')
const indexPath = path.join(distDir, 'index.html')
const outPath = path.join(distDir, '404.html')

if (!fs.existsSync(distDir)) {
  console.error('dist directory not found at', distDir)
  process.exit(1)
}

if (!fs.existsSync(indexPath)) {
  console.error('dist/index.html not found at', indexPath)
  process.exit(1)
}

fs.copyFileSync(indexPath, outPath)
console.log('Copied', indexPath, '->', outPath)
