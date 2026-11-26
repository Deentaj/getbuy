import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const indexPath = resolve('dist', 'index.html');
const html = await readFile(indexPath, 'utf8');
const metadata = `    <meta name="description" content="Shop groceries, fresh produce, packaged foods and local market products from nearby sellers in Nigeria." />
    <meta name="author" content="STRATOS LIMITED" />
    <meta name="robots" content="index, follow" />
    <link rel="canonical" href="https://getbuy.com.ng/" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="GetBuy" />
    <meta property="og:title" content="GetBuy | Shop Local in Nigeria" />
    <meta property="og:description" content="Shop groceries, fresh produce, packaged foods and local market products from nearby sellers in Nigeria." />
    <meta property="og:url" content="https://getbuy.com.ng/" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="GetBuy | Shop Local in Nigeria" />
    <meta name="twitter:description" content="Shop groceries, fresh produce, packaged foods and local market products from nearby sellers in Nigeria." />`;

if (!html.includes('<title>GetBuy</title>')) {
  throw new Error(`Expected GetBuy page title in ${indexPath}.`);
}
if (!html.includes('</head>')) {
  throw new Error(`Could not find the document head in ${indexPath}.`);
}
if (html.includes('name="description"')) {
  throw new Error(`SEO description already exists in ${indexPath}; refusing to add duplicate metadata.`);
}

await writeFile(
  indexPath,
  html.replace('<title>GetBuy</title>', '<title>GetBuy | Shop Local in Nigeria</title>')
    .replace('</head>', `\n${metadata}\n  </head>`),
);
