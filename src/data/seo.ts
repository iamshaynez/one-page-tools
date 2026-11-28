/**
 * JSON-LD（schema.org 结构化数据）构建函数 — ToolShell 与沉浸展品页共用
 */
import type { Tool } from './tools';

/** 分类 → schema.org applicationCategory */
export const LD_CATEGORY: Record<Tool['category'], string> = {
  classic: 'EntertainmentApplication',
  create: 'DesignApplication',
  dev: 'DeveloperApplication',
  play: 'GameApplication',
};

export function webAppLd(tool: Tool, url: string): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: tool.name,
    url,
    description: tool.seo?.description ?? tool.desc,
    applicationCategory: LD_CATEGORY[tool.category],
    operatingSystem: 'Web',
    browserRequirements: 'Requires JavaScript',
    inLanguage: 'zh-CN',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'CNY' },
    featureList: tool.keywords,
  };
}

export function breadcrumbLd(tool: Tool, url: string, homeUrl: string): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '大厅', item: homeUrl },
      { '@type': 'ListItem', position: 2, name: tool.name, item: url },
    ],
  };
}

export function faqLd(faq: NonNullable<Tool['seo']>['faq']): object | null {
  if (!faq?.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}
