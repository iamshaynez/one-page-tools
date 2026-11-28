import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://toys.xiaowenz.com',
  output: 'static',
  build: { format: 'directory' },
  integrations: [sitemap()],
  // 旧链接 /xxx.html -> /xxx/ 由 public/_redirects 处理（Cloudflare Pages）
});
