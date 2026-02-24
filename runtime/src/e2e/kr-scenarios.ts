export interface E2EPageLike {
  goto(url: string, options?: { waitUntil?: 'domcontentloaded' | 'load'; timeout?: number }): Promise<unknown>;
  title(): Promise<string>;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
  inputValue(selector: string): Promise<string>;
  url(): string;
  textContent(selector: string): Promise<string | null>;
}

export interface KrLiveScenario {
  id: string;
  domain: string;
  description: string;
  run(page: E2EPageLike): Promise<void>;
}

const DEFAULT_TIMEOUT = 20000;

async function assertTitleContains(page: E2EPageLike, expected: RegExp): Promise<void> {
  const title = await page.title();
  if (!expected.test(title)) {
    throw new Error(`unexpected title: ${title}`);
  }
}

async function assertUrlContains(page: E2EPageLike, expected: string): Promise<void> {
  if (!page.url().includes(expected)) {
    throw new Error(`url does not include "${expected}": ${page.url()}`);
  }
}

export const KR_LIVE_SCENARIOS: KrLiveScenario[] = [
  {
    id: 'kr_naver_home_searchbox',
    domain: 'naver.com',
    description: '네이버 메인 접근 후 검색 입력창 노출 확인',
    run: async (page) => {
      await page.goto('https://www.naver.com', { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });
      await page.waitForSelector('input[name="query"]', { timeout: DEFAULT_TIMEOUT });
      await assertTitleContains(page, /NAVER|네이버/i);
    }
  },
  {
    id: 'kr_naver_search_weather',
    domain: 'search.naver.com',
    description: '네이버 검색 결과 페이지에서 질의어 유지 확인',
    run: async (page) => {
      await page.goto(
        'https://search.naver.com/search.naver?query=%EB%82%A0%EC%94%A8',
        { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT }
      );
      await page.waitForSelector('input[name="query"]', { timeout: DEFAULT_TIMEOUT });
      const value = await page.inputValue('input[name="query"]');
      if (!value.includes('날씨')) {
        throw new Error(`expected query to include 날씨, got: ${value}`);
      }
      await assertUrlContains(page, 'query=');
    }
  },
  {
    id: 'kr_daum_home_searchbox',
    domain: 'daum.net',
    description: '다음 메인 접근 후 검색 입력창 노출 확인',
    run: async (page) => {
      await page.goto('https://www.daum.net', { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });
      await page.waitForSelector('input[name="q"]', { timeout: DEFAULT_TIMEOUT });
      await assertTitleContains(page, /Daum|다음/i);
    }
  },
  {
    id: 'kr_daum_search_news',
    domain: 'search.daum.net',
    description: '다음 검색 결과에서 뉴스 질의어 노출 확인',
    run: async (page) => {
      await page.goto(
        'https://search.daum.net/search?w=tot&q=%EB%89%B4%EC%8A%A4',
        { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT }
      );
      await page.waitForSelector('input[name="q"], input#q', { timeout: DEFAULT_TIMEOUT });
      await assertUrlContains(page, 'q=');
      const body = (await page.textContent('body')) ?? '';
      if (!body.includes('뉴스')) {
        throw new Error('expected body to contain 뉴스');
      }
    }
  },
  {
    id: 'kr_naver_news_home',
    domain: 'news.naver.com',
    description: '네이버 뉴스 메인 접근 후 헤드라인 영역 노출 확인',
    run: async (page) => {
      await page.goto('https://news.naver.com', { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });
      await page.waitForSelector('body', { timeout: DEFAULT_TIMEOUT });
      const body = (await page.textContent('body')) ?? '';
      if (!body.includes('뉴스')) {
        throw new Error('expected news home body to contain 뉴스');
      }
      await assertTitleContains(page, /뉴스|news/i);
    }
  },
  {
    id: 'kr_naver_finance_home',
    domain: 'finance.naver.com',
    description: '네이버 금융 메인 접근 후 금융 키워드 노출 확인',
    run: async (page) => {
      await page.goto('https://finance.naver.com', {
        waitUntil: 'domcontentloaded',
        timeout: DEFAULT_TIMEOUT
      });
      await page.waitForSelector('body', { timeout: DEFAULT_TIMEOUT });
      const body = (await page.textContent('body')) ?? '';
      if (!body.includes('증권') && !body.includes('금융')) {
        throw new Error('expected finance body to contain 증권 or 금융');
      }
      await assertTitleContains(page, /증권|금융|finance/i);
    }
  }
];
