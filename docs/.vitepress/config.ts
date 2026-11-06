import { defineConfig } from 'vitepress';

const SITE = 'https://almamun2b.github.io/query-builder-prisma/';
const REPO = 'https://github.com/almamun2b/query-builder-prisma';
const DESCRIPTION =
  'Type-safe, fluent Prisma query builder: search, filtering, sorting, offset and cursor (keyset) pagination, and select/include projections. Zero dependencies, works with every Prisma version and database.';

export default defineConfig({
  title: 'query-builder-prisma',
  titleTemplate: ':title | query-builder-prisma',
  description: DESCRIPTION,
  lang: 'en-US',
  base: '/query-builder-prisma/',
  srcDir: '.',
  srcExclude: ['AUDIT.md'],
  rewrites: { 'readme.md': 'index.md' },
  cleanUrls: true,
  lastUpdated: true,
  sitemap: { hostname: SITE },

  head: [
    ['meta', { name: 'theme-color', content: '#3c8772' }],
    [
      'meta',
      {
        name: 'keywords',
        content:
          'prisma query builder, prisma pagination, prisma cursor pagination, prisma keyset pagination, prisma filter, prisma search, type-safe prisma, typescript, nestjs, nextjs, express',
      },
    ],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'query-builder-prisma' }],
    ['meta', { property: 'og:image', content: `${SITE}og-image.png` }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:image', content: `${SITE}og-image.png` }],
    [
      'script',
      { type: 'application/ld+json' },
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'SoftwareSourceCode',
        name: 'query-builder-prisma',
        description: DESCRIPTION,
        codeRepository: REPO,
        url: SITE,
        license: 'https://opensource.org/licenses/MIT',
        programmingLanguage: 'TypeScript',
        runtimePlatform: 'Node.js',
        author: { '@type': 'Person', name: 'Mamun', url: 'https://github.com/almamun2b' },
      }),
    ],
  ],

  transformPageData(pageData) {
    const path = pageData.relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '');
    const url = `${SITE}${path}`;
    const head = (pageData.frontmatter.head ??= []);
    head.push(['link', { rel: 'canonical', href: url }]);
    head.push(['meta', { property: 'og:url', content: url }]);
    head.push(['meta', { property: 'og:title', content: pageData.title }]);
    head.push([
      'meta',
      { property: 'og:description', content: pageData.description || DESCRIPTION },
    ]);
  },

  themeConfig: {
    nav: [
      { text: 'Getting started', link: '/getting-started' },
      { text: 'Guides', link: '/guides/pagination' },
      { text: 'API', link: '/api/query-builder' },
      { text: 'npm', link: 'https://www.npmjs.com/package/query-builder-prisma' },
    ],
    sidebar: [
      {
        text: 'Start here',
        items: [
          { text: 'Overview', link: '/' },
          { text: 'Getting started', link: '/getting-started' },
          { text: 'Framework recipes', link: '/framework-recipes' },
          { text: 'Use cases', link: '/examples/use-cases' },
        ],
      },
      {
        text: 'Guides',
        items: [
          { text: 'Filtering and search', link: '/guides/filtering' },
          { text: 'Sorting', link: '/guides/sorting' },
          { text: 'Offset pagination', link: '/guides/pagination' },
          { text: 'Cursor pagination', link: '/guides/cursor-pagination' },
          { text: 'Projections', link: '/guides/projections' },
          { text: 'Dialects', link: '/guides/dialects' },
          { text: 'Advanced patterns', link: '/guides/advanced' },
        ],
      },
      {
        text: 'API reference',
        items: [
          { text: 'QueryBuilder', link: '/api/query-builder' },
          { text: 'Functions and constants', link: '/api/functions' },
          { text: 'Types', link: '/api/types' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: REPO }],
    search: { provider: 'local' },
    editLink: {
      pattern: `${REPO}/edit/main/docs/:path`,
      text: 'Edit this page on GitHub',
    },
    footer: { message: 'Released under the MIT License.' },
  },
});
