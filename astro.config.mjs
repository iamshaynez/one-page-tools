import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://tools.xiaowenz.com',
  output: 'static',
  build: { format: 'directory' },
  // 旧链接 /xxx.html -> /xxx/ 由 public/_redirects 处理（Cloudflare Pages）
});
