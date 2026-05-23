const fs = require('fs');
const html = fs.readFileSync('flyforsure-design-system-v3.html', 'utf-8');
const match = html.match(/<style>([\s\S]*?)<\/style>/);
if (match) {
  // also add some base imports at the top
  const css = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
` + match[1].trim();
  fs.writeFileSync('src/index.css', css);
  console.log('Successfully extracted CSS to src/index.css');
} else {
  console.error('Could not find style tag in HTML');
}
