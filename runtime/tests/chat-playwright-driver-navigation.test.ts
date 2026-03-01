import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ChatPlaywrightDriver } from '../src/backend/chat-playwright-driver';

function html(title: string, body: string): string {
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      body { font-family: sans-serif; margin: 24px; }
      nav a, nav button { margin-right: 8px; }
    </style>
  </head>
  <body>
    ${body}
  </body>
</html>`;
}

function route(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url ?? '/';
  const path = url.split('?')[0] ?? '/';
  let payload: string;
  if (path === '/') {
    payload = html(
      '메인',
      `
      <header>
        <nav role="navigation">
          <a href="/sports" aria-label="카테고리">카테고리</a>
          <a href="/news">뉴스</a>
        </nav>
      </header>
      <main>
        <h1>쇼핑 메인</h1>
      </main>
    `
    );
  } else if (path === '/sports') {
    payload = html(
      '스포츠 카테고리',
      `
      <header>
        <nav role="navigation">
          <a href="/women-sports">여성 스포츠 의류</a>
          <a href="/sports/accessory">스포츠용품</a>
        </nav>
      </header>
      <main>
        <h1>스포츠 카테고리</h1>
      </main>
    `
    );
  } else if (path === '/women-sports') {
    payload = html(
      '여성스포츠의류',
      `
      <header>
        <nav role="navigation">
          <a href="/hiking-wear">등산복</a>
          <a href="/women-sports/running">러닝</a>
        </nav>
      </header>
      <main>
        <h1>여성스포츠의류</h1>
      </main>
    `
    );
  } else if (path === '/hiking-wear') {
    payload = html(
      '등산복 결과',
      `
      <header>
        <nav role="navigation">
          <a href="/hiking-wear/filter">가격 필터</a>
        </nav>
      </header>
      <main>
        <h1>등산복</h1>
        <p>10만원 이하 레드 상품</p>
      </main>
      `
    );
  } else if (path === '/weak') {
    payload = html(
      '약한 메뉴',
      `
      <header>
        <nav role="navigation">
          <a href="#" id="weakMenu">여성스포츠의류</a>
          <a href="/news">뉴스</a>
        </nav>
      </header>
      <main>
        <div id="submenu" style="display:none; margin-top: 12px;">
          <a href="/weak-hiking">등산복</a>
        </div>
      </main>
      <script>
        const trigger = document.getElementById('weakMenu');
        const submenu = document.getElementById('submenu');
        if (trigger && submenu) {
          trigger.addEventListener('click', (event) => {
            event.preventDefault();
            submenu.style.display = 'block';
          });
        }
      </script>
    `
    );
  } else if (path === '/weak-hiking') {
    payload = html(
      '약한 메뉴 결과',
      `
      <main>
        <h1>여성스포츠의류 등산복</h1>
        <p>price filter zone</p>
      </main>
    `
    );
  } else if (path === '/filter-trap') {
    payload = html(
      '필터 트랩',
      `
      <header>
        <nav role="navigation">
          <a href="/product-promo">가격 필터 색상 정렬 99,000원 특가 상품 보기</a>
          <button id="openFilter" aria-label="필터 열기">필터</button>
        </nav>
      </header>
      <main>
        <h1>여성스포츠의류 등산복 목록</h1>
        <section id="panel" hidden>
          <button>10만원 이하</button>
          <button>레드</button>
        </section>
      </main>
      <script>
        const openFilter = document.getElementById('openFilter');
        const panel = document.getElementById('panel');
        if (openFilter && panel) {
          openFilter.addEventListener('click', () => {
            panel.hidden = false;
            location.hash = 'filters';
          });
        }
      </script>
    `
    );
  } else if (path === '/price-input') {
    payload = html(
      '가격 입력 테스트',
      `
      <main>
        <h1>등산복 필터</h1>
        <form action="/price-applied" method="get" id="priceForm">
          <label for="maxPrice">최대 가격</label>
          <input id="maxPrice" name="maxPrice" type="number" placeholder="가격 입력" />
          <button type="submit">적용</button>
        </form>
      </main>
    `
    );
  } else if (path === '/price-input-trap') {
    payload = html(
      '가격 입력 타입 트랩',
      `
      <main>
        <h1>가격 필터 타입 트랩</h1>
        <form action="/price-trap-applied" method="get" id="priceTrapForm">
          <label for="priceCheck">최대 가격 적용</label>
          <input id="priceCheck" name="priceCheck" type="checkbox" value="1" />
          <label for="maxPriceText">최대 가격 입력</label>
          <input id="maxPriceText" name="maxPrice" type="text" placeholder="가격 입력" />
          <button type="submit">적용</button>
        </form>
      </main>
    `
    );
  } else if (path === '/price-trap-applied') {
    const maxPrice = new URL(`http://localhost${url}`).searchParams.get('maxPrice') ?? '';
    payload = html(
      '가격 트랩 적용 결과',
      `
      <main>
        <h1>가격 트랩 적용 완료</h1>
        <p>maxPrice=${maxPrice}</p>
      </main>
    `
    );
  } else if (path === '/search-vs-budget') {
    payload = html(
      '검색/예산 분리 테스트',
      `
      <main>
        <h1>검색과 가격 입력이 같이 있는 페이지</h1>
        <form action="/search-applied" method="get" id="searchForm">
          <label for="query">상품 검색</label>
          <input id="query" name="query" type="text" placeholder="검색어 입력" />
          <button type="submit">검색</button>
        </form>
        <form action="/price-applied" method="get" id="priceForm">
          <label for="maxPrice">최대 가격</label>
          <input id="maxPrice" name="maxPrice" type="number" placeholder="가격 입력" />
          <button type="submit">적용</button>
        </form>
      </main>
    `
    );
  } else if (path === '/search-applied') {
    const query = new URL(`http://localhost${url}`).searchParams.get('query') ?? '';
    payload = html(
      '검색 적용 결과',
      `
      <main>
        <h1>검색 실행 완료</h1>
        <p>query=${query}</p>
      </main>
    `
    );
  } else if (path === '/price-applied') {
    const maxPrice = new URL(`http://localhost${url}`).searchParams.get('maxPrice') ?? '';
    payload = html(
      '가격 적용 결과',
      `
      <main>
        <h1>가격 적용 완료</h1>
        <p>maxPrice=${maxPrice}</p>
      </main>
    `
    );
  } else if (path === '/product-promo') {
    payload = html(
      '프로모션 상품',
      `
      <main>
        <h1>프로모션 상품 상세</h1>
        <p>이 페이지는 필터가 아닌 상품 상세 페이지입니다.</p>
      </main>
    `
    );
  } else if (path === '/root-trap') {
    payload = html(
      '루트 트랩',
      `
      <header>
        <nav role="navigation">
          <a href="/sports">카테고리</a>
        </nav>
        <button type="button">상품 전체삭제</button>
      </header>
      <main>
        <h1>루트 페이지</h1>
      </main>
    `
    );
  } else if (path === '/hover-only') {
    payload = html(
      '호버 메뉴',
      `
      <header>
        <nav role="navigation">
          <a href="/hover-noop" id="topMenu">스포츠 · 골프</a>
          <div id="hoverLayer" style="display:none; margin-top: 12px;">
            <a href="/hover-women">여성스포츠의류</a>
          </div>
        </nav>
      </header>
      <main>
        <h1>호버 메뉴 페이지</h1>
      </main>
      <script>
        const topMenu = document.getElementById('topMenu');
        const hoverLayer = document.getElementById('hoverLayer');
        if (topMenu && hoverLayer) {
          topMenu.addEventListener('mouseenter', () => {
            hoverLayer.style.display = 'block';
          });
        }
      </script>
    `
    );
  } else if (path === '/hover-prefer-specific') {
    payload = html(
      '호버 특이점 우선',
      `
      <header>
        <nav role="navigation">
          <a href="/hover-ai" id="topAi">AI · 디지털</a>
          <a href="/hover-sports" id="topSports">스포츠 · 골프</a>
          <div id="aiLayer" style="display:none; margin-top: 10px;">
            <a href="/hover-ai-women">여성스포츠의류</a>
          </div>
          <div id="sportsLayer" style="display:none; margin-top: 10px;">
            <a href="/hover-target-women">여성스포츠의류</a>
          </div>
        </nav>
      </header>
      <main>
        <h1>호버 특이점 우선 페이지</h1>
      </main>
      <script>
        const topAi = document.getElementById('topAi');
        const topSports = document.getElementById('topSports');
        const aiLayer = document.getElementById('aiLayer');
        const sportsLayer = document.getElementById('sportsLayer');
        if (topAi && aiLayer && sportsLayer) {
          topAi.addEventListener('mouseenter', () => {
            aiLayer.style.display = 'block';
            sportsLayer.style.display = 'none';
          });
        }
        if (topSports && sportsLayer && aiLayer) {
          topSports.addEventListener('mouseenter', () => {
            sportsLayer.style.display = 'block';
            aiLayer.style.display = 'none';
          });
        }
      </script>
    `
    );
  } else if (path === '/hover-ai') {
    payload = html(
      'AI 메뉴 진입',
      `
      <main>
        <h1>AI 메뉴 진입 페이지</h1>
      </main>
    `
    );
  } else if (path === '/hover-ai-women') {
    payload = html(
      'AI 여성 카테고리',
      `
      <main>
        <h1>AI 여성 카테고리 (오답 경로)</h1>
      </main>
    `
    );
  } else if (path === '/hover-sports') {
    payload = html(
      '스포츠 메뉴 진입',
      `
      <header>
        <nav role="navigation">
          <a href="/hover-target-women">여성스포츠의류</a>
        </nav>
      </header>
      <main>
        <h1>스포츠 메뉴 진입 페이지</h1>
      </main>
    `
    );
  } else if (path === '/hover-target-women') {
    payload = html(
      '타겟 여성 카테고리',
      `
      <header>
        <nav role="navigation">
          <a href="/hover-target-hiking">등산복</a>
        </nav>
      </header>
      <main>
        <h1>여성스포츠의류 타겟 경로</h1>
      </main>
    `
    );
  } else if (path === '/hover-target-hiking') {
    payload = html(
      '타겟 등산복 결과',
      `
      <main>
        <h1>등산복 타겟 결과 페이지</h1>
      </main>
    `
    );
  } else if (path === '/hover-noop') {
    payload = html(
      '잘못된 호버 클릭 경로',
      `
      <main>
        <h1>클릭하면 이 페이지로 이동</h1>
      </main>
    `
    );
  } else if (path === '/hover-women') {
    payload = html(
      '호버 여성 카테고리',
      `
      <header>
        <nav role="navigation">
          <a href="/hiking-wear">등산복</a>
        </nav>
      </header>
      <main>
        <h1>여성스포츠의류</h1>
      </main>
    `
    );
  } else if (path === '/hover-layer-trap') {
    payload = html(
      '호버 레이어 트랩',
      `
      <header>
        <nav role="navigation" style="position: relative;">
          <a href="/trap-root-click" id="topRoot">스포츠</a>
          <div
            id="flyoutLayer"
            style="display:none; position:absolute; top:30px; left:0; border:1px solid #ddd; background:#fff; padding:8px; z-index:1000;"
          >
            <a href="/trap-disabled" id="disabledMenu" style="pointer-events:none; opacity:0.6; display:block;">여성스포츠의류</a>
            <a href="/trap-women" id="goodMenu" style="display:block;">여성스포츠의류 카테고리</a>
          </div>
        </nav>
      </header>
      <main style="margin-top: 80px;">
        <a href="/trap-under" id="underLink">여성스포츠의류</a>
      </main>
      <script>
        const topRoot = document.getElementById('topRoot');
        const flyoutLayer = document.getElementById('flyoutLayer');
        let closeTimer = null;
        const openLayer = () => {
          if (closeTimer) clearTimeout(closeTimer);
          flyoutLayer.style.display = 'block';
        };
        const closeLater = () => {
          if (closeTimer) clearTimeout(closeTimer);
          closeTimer = setTimeout(() => {
            flyoutLayer.style.display = 'none';
          }, 80);
        };
        if (topRoot && flyoutLayer) {
          topRoot.addEventListener('mouseenter', openLayer);
          topRoot.addEventListener('mouseleave', closeLater);
          flyoutLayer.addEventListener('mouseenter', openLayer);
          flyoutLayer.addEventListener('mouseleave', closeLater);
        }
      </script>
    `
    );
  } else if (path === '/trap-root-click') {
    payload = html(
      '루트 잘못 클릭',
      `
      <main>
        <h1>루트 클릭 오동작 페이지</h1>
      </main>
    `
    );
  } else if (path === '/trap-disabled') {
    payload = html(
      '비활성 메뉴',
      `
      <main>
        <h1>비활성 메뉴 페이지</h1>
      </main>
    `
    );
  } else if (path === '/trap-under') {
    payload = html(
      '본문 링크 오동작',
      `
      <main>
        <h1>본문 링크 오동작 페이지</h1>
      </main>
    `
    );
  } else if (path === '/trap-women') {
    payload = html(
      '트랩 여성 카테고리',
      `
      <header>
        <nav role="navigation">
          <a href="/trap-hiking">등산복</a>
        </nav>
      </header>
      <main>
        <h1>여성스포츠의류 카테고리</h1>
      </main>
    `
    );
  } else if (path === '/trap-hiking') {
    payload = html(
      '트랩 등산복 결과',
      `
      <main>
        <h1>등산복 결과 페이지</h1>
      </main>
    `
    );
  } else if (path === '/menu-vs-list') {
    payload = html(
      '메뉴와 리스트 혼합',
      `
      <header>
        <nav role="navigation">
          <a href="/menu-outdoor">아웃도어 메뉴 등산복</a>
        </nav>
      </header>
      <main>
        <article class="product card">
          <a href="/product-heavy">아웃도어프로덕츠 등산복 특가 19,900원</a>
        </article>
      </main>
    `
    );
  } else if (path === '/ad-guard') {
    payload = html(
      '광고 가드 시작',
      `
      <header>
        <nav role="navigation">
          <a href="/ad-guard-level1">여성스포츠의류</a>
        </nav>
      </header>
      <main>
        <h1>광고 가드 시작</h1>
      </main>
    `
    );
  } else if (path === '/ad-guard-level1') {
    payload = html(
      '광고 가드 레벨1',
      `
      <header>
        <nav role="navigation">
          <a href="/ad-guard-level2">등산복 카테고리</a>
        </nav>
      </header>
      <main>
        <a href="/bridge/loadingBridgePowerShopping.php?adkeyword=등산복">
          등산복 여성 경량 자켓 할인 59,800원
        </a>
      </main>
    `
    );
  } else if (path === '/ad-guard-level2') {
    payload = html(
      '광고 가드 레벨2',
      `
      <header>
        <nav role="navigation">
          <a href="/ad-guard-final">필터 설정</a>
        </nav>
      </header>
      <main>
        <h1>등산복 카테고리 목록</h1>
      </main>
    `
    );
  } else if (path === '/ad-guard-final') {
    payload = html(
      '광고 가드 최종',
      `
      <main>
        <h1>필터 설정 완료</h1>
      </main>
    `
    );
  } else if (path === '/bridge/loadingBridgePowerShopping.php') {
    payload = html(
      '광고 브리지',
      `
      <main>
        <h1>광고 브리지 진입</h1>
      </main>
    `
    );
  } else if (path === '/menu-outdoor') {
    payload = html(
      '메뉴 경유 성공',
      `
      <main>
        <h1>아웃도어 메뉴 진입 완료</h1>
      </main>
    `
    );
  } else if (path === '/product-heavy') {
    payload = html(
      '상품 상세',
      `
      <main>
        <h1>상품 상세 페이지</h1>
      </main>
    `
    );
  } else if (path === '/reopen-needed') {
    payload = html(
      '재오픈 필요',
      `
      <header>
        <button id="menuToggle" aria-expanded="false">카테고리</button>
      </header>
      <main>
        <div id="layer" style="display:none;">
          <a href="/reopen-women">여성스포츠의류</a>
        </div>
      </main>
      <script>
        const toggle = document.getElementById('menuToggle');
        const layer = document.getElementById('layer');
        let closeTimer = null;
        if (toggle && layer) {
          toggle.addEventListener('click', () => {
            layer.style.display = 'block';
            toggle.setAttribute('aria-expanded', 'true');
            if (closeTimer) clearTimeout(closeTimer);
            closeTimer = setTimeout(() => {
              layer.style.display = 'none';
              toggle.setAttribute('aria-expanded', 'false');
            }, 120);
          });
        }
      </script>
    `
    );
  } else if (path === '/reopen-women') {
    payload = html(
      '재오픈 성공',
      `
      <main>
        <h1>여성스포츠의류 진입</h1>
      </main>
    `
    );
  } else {
    payload = html('기타', '<h1>기타 페이지</h1>');
  }

  res.statusCode = 200;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(payload);
}

async function startFixtureServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer(route);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error?: Error) => (error ? reject(error) : resolve()));
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to resolve fixture server address');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  };
}

describe('ChatPlaywrightDriver hint navigation', () => {
  it(
    'traverses category hints across multiple hops without site-specific hardcoding',
    async () => {
      const fixture = await startFixtureServer();
      const screenshotRoot = await mkdtemp(join(tmpdir(), 'chat-driver-nav-'));
      const driver = new ChatPlaywrightDriver({
        browserMode: 'headless',
        screenshotRoot,
        runId: `run-${Date.now()}`,
        sessionId: `sess-${Date.now()}`
      });

      try {
        await driver.start();
        await driver.navigate(`${fixture.baseUrl}/`);

        const logs: Array<{ level: 'info' | 'warn' | 'error'; message: string }> = [];
        logs.push(
          ...(await driver.navigateListingByHints({
            pathHints: ['카테고리'],
            maxPathSteps: 7,
            objective: {
              includeAny: ['카테고리', '스포츠'],
              avoidAny: ['뉴스', 'news', 'ai'],
              strict: true
            }
          }))
        );
        logs.push(
          ...(await driver.navigateListingByHints({
            pathHints: ['스포츠'],
            maxPathSteps: 7,
            objective: {
              includeAny: ['스포츠', '여성스포츠의류'],
              avoidAny: ['뉴스', 'news', 'ai'],
              strict: true
            }
          }))
        );
        logs.push(
          ...(await driver.navigateListingByHints({
            pathHints: ['여성스포츠의류'],
            maxPathSteps: 7,
            objective: {
              includeAny: ['여성스포츠의류', '등산복'],
              avoidAny: ['뉴스', 'news', 'ai'],
              strict: true
            }
          }))
        );
        logs.push(
          ...(await driver.navigateListingByHints({
            pathHints: ['등산복'],
            maxPathSteps: 7,
            objective: {
              includeAny: ['등산복'],
              avoidAny: ['뉴스', 'news', 'ai'],
              strict: true
            }
          }))
        );

        expect(logs.some((entry) => entry.message.includes('hop 1/1'))).toBe(true);
        expect(logs.some((entry) => entry.message.includes('traversal completed'))).toBe(true);
        expect(
          logs.some(
            (entry) =>
              entry.message.includes('여성 스포츠 의류') ||
              entry.message.includes('여성스포츠의류')
          )
        ).toBe(true);

        const summary = await driver.summarizeCurrentPage(3);
        expect(summary).toContain('/hiking-wear');
        expect(summary).toContain('등산복 결과');
      } finally {
        await driver.close();
        await fixture.close();
        await rm(screenshotRoot, { recursive: true, force: true });
      }
    },
    90000
  );

  it(
    'recovers from weak hash navigation by following a stronger link without hardcoded selectors',
    async () => {
      const fixture = await startFixtureServer();
      const screenshotRoot = await mkdtemp(join(tmpdir(), 'chat-driver-nav-weak-'));
      const driver = new ChatPlaywrightDriver({
        browserMode: 'headless',
        screenshotRoot,
        runId: `run-${Date.now()}`,
        sessionId: `sess-${Date.now()}`
      });

      try {
        await driver.start();
        await driver.navigate(`${fixture.baseUrl}/weak`);

        const logs: Array<{ level: 'info' | 'warn' | 'error'; message: string }> = [];
        logs.push(
          ...(await driver.navigateListingByHints({
            pathHints: ['여성스포츠의류'],
            maxPathSteps: 5,
            objective: {
              includeAny: ['여성스포츠의류', '등산복'],
              avoidAny: ['뉴스', 'news'],
              strict: true
            }
          }))
        );
        logs.push(
          ...(await driver.navigateListingByHints({
            pathHints: ['등산복'],
            maxPathSteps: 5,
            objective: {
              includeAny: ['등산복'],
              avoidAny: ['뉴스', 'news'],
              strict: true
            }
          }))
        );

        expect(
          logs.some((entry) => /Weak navigation recovery succeeded:/i.test(entry.message)) ||
            logs.some((entry) => /Hint navigation hop 1\/1:/i.test(entry.message))
        ).toBe(true);
        const summary = await driver.summarizeCurrentPage(3);
        expect(summary).toContain('/weak-hiking');
        expect(summary).toContain('약한 메뉴 결과');
      } finally {
        await driver.close();
        await fixture.close();
        await rm(screenshotRoot, { recursive: true, force: true });
      }
    },
    90000
  );

  it(
    'prioritizes filter controls over promo/product links during filter actions',
    async () => {
      const fixture = await startFixtureServer();
      const screenshotRoot = await mkdtemp(join(tmpdir(), 'chat-driver-nav-filter-'));
      const driver = new ChatPlaywrightDriver({
        browserMode: 'headless',
        screenshotRoot,
        runId: `run-${Date.now()}`,
        sessionId: `sess-${Date.now()}`
      });

      try {
        await driver.start();
        await driver.navigate(`${fixture.baseUrl}/filter-trap`);

        const logs = await driver.clickByHints({
          textHints: ['필터', '조건', '가격', '색상', '정렬', 'filter', 'sort', 'price'],
          label: 'listing-filter-open'
        });
        const summary = await driver.summarizeCurrentPage(3);
        const actionLine = logs.find((entry) => /^Action click\(listing-filter-open\)/i.test(entry.message));

        expect(actionLine?.message ?? '').not.toContain('/product-promo');
        expect(summary).not.toContain('/product-promo');
      } finally {
        await driver.close();
        await fixture.close();
        await rm(screenshotRoot, { recursive: true, force: true });
      }
    },
    90000
  );

  it(
    'fills visible budget input via fallback when semantic input ranking misses it',
    async () => {
      const fixture = await startFixtureServer();
      const screenshotRoot = await mkdtemp(join(tmpdir(), 'chat-driver-nav-budget-input-'));
      const driver = new ChatPlaywrightDriver({
        browserMode: 'headless',
        screenshotRoot,
        runId: `run-${Date.now()}`,
        sessionId: `sess-${Date.now()}`
      });

      try {
        await driver.start();
        await driver.navigate(`${fixture.baseUrl}/price-input`);

        const logs = await driver.typeByHints({
          textHints: ['가격', '최대', 'price', 'max'],
          value: '100000원 이하',
          submit: true,
          label: 'Apply price filter (100,000 KRW)'
        });
        const summary = await driver.summarizeCurrentPage(3);

        expect(summary).toContain('/price-applied?maxPrice=100000');
        expect(logs.some((entry) => /^Action type\(Apply price filter/i.test(entry.message))).toBe(true);
      } finally {
        await driver.close();
        await fixture.close();
        await rm(screenshotRoot, { recursive: true, force: true });
      }
    },
    90000
  );

  it(
    'skips checkbox/radio inputs and fills editable text input for budget typing',
    async () => {
      const fixture = await startFixtureServer();
      const screenshotRoot = await mkdtemp(join(tmpdir(), 'chat-driver-nav-budget-type-trap-'));
      const driver = new ChatPlaywrightDriver({
        browserMode: 'headless',
        screenshotRoot,
        runId: `run-${Date.now()}`,
        sessionId: `sess-${Date.now()}`
      });

      try {
        await driver.start();
        await driver.navigate(`${fixture.baseUrl}/price-input-trap`);

        const logs = await driver.typeByHints({
          textHints: ['가격', '최대', 'price', 'max'],
          value: '100000원 이하',
          submit: true,
          label: 'Apply trap price filter (100,000 KRW)',
          intent: 'filter',
          allowBudgetFallback: true
        });
        const summary = await driver.summarizeCurrentPage(3);

        expect(summary).toContain('/price-trap-applied?maxPrice=100000');
        expect(logs.some((entry) => /^Action type\(Apply trap price filter/i.test(entry.message))).toBe(true);
      } finally {
        await driver.close();
        await fixture.close();
        await rm(screenshotRoot, { recursive: true, force: true });
      }
    },
    90000
  );

  it(
    'does not route search-submit action into budget input fallback',
    async () => {
      const fixture = await startFixtureServer();
      const screenshotRoot = await mkdtemp(join(tmpdir(), 'chat-driver-nav-search-vs-budget-'));
      const driver = new ChatPlaywrightDriver({
        browserMode: 'headless',
        screenshotRoot,
        runId: `run-${Date.now()}`,
        sessionId: `sess-${Date.now()}`
      });

      try {
        await driver.start();
        await driver.navigate(`${fixture.baseUrl}/search-vs-budget`);

        const logs = await driver.typeByHints({
          textHints: ['검색', 'search', '상품검색'],
          value: '여성 등산복 레드 10만원 이하',
          submit: true,
          label: 'fallback-search-submit',
          intent: 'search',
          allowBudgetFallback: false
        });
        const summary = await driver.summarizeCurrentPage(3);

        expect(logs.some((entry) => /^Action type\(fallback-search-submit\):/i.test(entry.message))).toBe(true);
        expect(summary).toContain('/search-applied?query=');
        expect(summary).not.toContain('/price-applied?maxPrice=');
      } finally {
        await driver.close();
        await fixture.close();
        await rm(screenshotRoot, { recursive: true, force: true });
      }
    },
    90000
  );

  it(
    'does not route filter budget typing into search input controls',
    async () => {
      const fixture = await startFixtureServer();
      const screenshotRoot = await mkdtemp(join(tmpdir(), 'chat-driver-nav-budget-vs-search-'));
      const driver = new ChatPlaywrightDriver({
        browserMode: 'headless',
        screenshotRoot,
        runId: `run-${Date.now()}`,
        sessionId: `sess-${Date.now()}`
      });

      try {
        await driver.start();
        await driver.navigate(`${fixture.baseUrl}/search-vs-budget`);

        const logs = await driver.typeByHints({
          textHints: ['가격', '최대', 'price', 'max'],
          value: '100000원 이하',
          submit: true,
          label: 'Set max price 100,000 KRW',
          intent: 'filter',
          allowBudgetFallback: true
        });
        const summary = await driver.summarizeCurrentPage(3);

        expect(logs.some((entry) => /^Action type\(Set max price 100,000 KRW\):/i.test(entry.message))).toBe(true);
        expect(summary).toContain('/price-applied?maxPrice=100000');
        expect(summary).not.toContain('/search-applied?query=');
      } finally {
        await driver.close();
        await fixture.close();
        await rm(screenshotRoot, { recursive: true, force: true });
      }
    },
    90000
  );

  it(
    'does not pre-open destructive "all/clear" controls during root menu expansion',
    async () => {
      const fixture = await startFixtureServer();
      const screenshotRoot = await mkdtemp(join(tmpdir(), 'chat-driver-nav-root-trap-'));
      const driver = new ChatPlaywrightDriver({
        browserMode: 'headless',
        screenshotRoot,
        runId: `run-${Date.now()}`,
        sessionId: `sess-${Date.now()}`
      });

      try {
        await driver.start();
        await driver.navigate(`${fixture.baseUrl}/root-trap`);

        const logs = await driver.navigateListingByHints({
          pathHints: ['카테고리', '메뉴'],
          maxPathSteps: 5,
          objective: {
            includeAny: ['카테고리', '스포츠'],
            avoidAny: ['삭제', 'clear', 'reset'],
            strict: true
          }
        });
        const preOpenTexts = logs
          .filter((entry) => /^Hint navigation pre-open:/i.test(entry.message))
          .map((entry) => entry.message);

        expect(preOpenTexts.some((message) => message.includes('상품 전체삭제'))).toBe(false);
      } finally {
        await driver.close();
        await fixture.close();
        await rm(screenshotRoot, { recursive: true, force: true });
      }
    },
    90000
  );

  it(
    'supports hover-expanded menu traversal before clicking submenu entries',
    async () => {
      const fixture = await startFixtureServer();
      const screenshotRoot = await mkdtemp(join(tmpdir(), 'chat-driver-nav-hover-'));
      const driver = new ChatPlaywrightDriver({
        browserMode: 'headless',
        screenshotRoot,
        runId: `run-${Date.now()}`,
        sessionId: `sess-${Date.now()}`
      });

      try {
        await driver.start();
        await driver.navigate(`${fixture.baseUrl}/hover-only`);

        const logs = await driver.navigateListingByHints({
          pathHints: ['스포츠', '여성스포츠의류', '등산복'],
          maxPathSteps: 6,
          objective: {
            includeAny: ['여성스포츠의류', '등산복'],
            avoidAny: ['뉴스', 'news', 'ai'],
            strict: true
          }
        });

        const summary = await driver.summarizeCurrentPage(3);
        expect(summary).toContain('/hiking-wear');
        expect(logs.some((entry) => /Hint navigation hover expansion:/i.test(entry.message))).toBe(true);
      } finally {
        await driver.close();
        await fixture.close();
        await rm(screenshotRoot, { recursive: true, force: true });
      }
    },
    90000
  );

  it(
    'prefers specific hover root menu over unrelated menu when category hints are present',
    async () => {
      const fixture = await startFixtureServer();
      const screenshotRoot = await mkdtemp(join(tmpdir(), 'chat-driver-nav-hover-specific-'));
      const driver = new ChatPlaywrightDriver({
        browserMode: 'headless',
        screenshotRoot,
        runId: `run-${Date.now()}`,
        sessionId: `sess-${Date.now()}`
      });

      try {
        await driver.start();
        await driver.navigate(`${fixture.baseUrl}/hover-prefer-specific`);

        const logs = await driver.navigateListingByHints({
          pathHints: ['카테고리', '스포츠', '여성스포츠의류', '등산복'],
          maxPathSteps: 7,
          objective: {
            includeAny: ['스포츠', '여성스포츠의류', '등산복'],
            avoidAny: ['ai', '디지털', 'news', 'blog'],
            strict: true
          }
        });

        const summary = await driver.summarizeCurrentPage(3);
        const hopTexts = logs
          .filter((entry) => /^Hint navigation hop /i.test(entry.message))
          .map((entry) => entry.message.toLowerCase());
        expect(summary).toContain('/hover-target-hiking');
        expect(summary).not.toContain('/hover-ai');
        expect(summary).not.toContain('/hover-ai-women');
        expect(hopTexts.some((line) => line.includes('ai'))).toBe(false);
      } finally {
        await driver.close();
        await fixture.close();
        await rm(screenshotRoot, { recursive: true, force: true });
      }
    },
    90000
  );

  it(
    'keeps traversal within navigation scope when hover menus overlap body links',
    async () => {
      const fixture = await startFixtureServer();
      const screenshotRoot = await mkdtemp(join(tmpdir(), 'chat-driver-nav-hover-scope-'));
      const driver = new ChatPlaywrightDriver({
        browserMode: 'headless',
        screenshotRoot,
        runId: `run-${Date.now()}`,
        sessionId: `sess-${Date.now()}`
      });

      try {
        await driver.start();
        await driver.navigate(`${fixture.baseUrl}/hover-layer-trap`);

        const logs = await driver.navigateListingByHints({
          pathHints: ['스포츠', '여성스포츠의류', '등산복'],
          maxPathSteps: 6,
          objective: {
            includeAny: ['여성스포츠의류', '등산복'],
            avoidAny: ['뉴스', 'news', 'ai'],
            strict: true
          }
        });

        const summary = await driver.summarizeCurrentPage(3);
        expect(summary).toContain('/trap-hiking');
        expect(summary).not.toContain('/trap-under');
        expect(logs.some((entry) => /scope lock/i.test(entry.message))).toBe(true);
      } finally {
        await driver.close();
        await fixture.close();
        await rm(screenshotRoot, { recursive: true, force: true });
      }
    },
    90000
  );

  it(
    'prefers navigation scope candidates over product-list cards in hint navigation',
    async () => {
      const fixture = await startFixtureServer();
      const screenshotRoot = await mkdtemp(join(tmpdir(), 'chat-driver-nav-scope-'));
      const driver = new ChatPlaywrightDriver({
        browserMode: 'headless',
        screenshotRoot,
        runId: `run-${Date.now()}`,
        sessionId: `sess-${Date.now()}`
      });

      try {
        await driver.start();
        await driver.navigate(`${fixture.baseUrl}/menu-vs-list`);
        const logs = await driver.navigateListingByHints({
          pathHints: ['등산복'],
          maxPathSteps: 4
        });
        const summary = await driver.summarizeCurrentPage(3);

        expect(summary).toContain('/menu-outdoor');
        expect(logs.some((entry) => entry.message.includes('아웃도어프로덕츠'))).toBe(false);
      } finally {
        await driver.close();
        await fixture.close();
        await rm(screenshotRoot, { recursive: true, force: true });
      }
    },
    90000
  );

  it(
    're-opens navigation surface when non-root hint hop starts without visible submenu',
    async () => {
      const fixture = await startFixtureServer();
      const screenshotRoot = await mkdtemp(join(tmpdir(), 'chat-driver-nav-reopen-'));
      const driver = new ChatPlaywrightDriver({
        browserMode: 'headless',
        screenshotRoot,
        runId: `run-${Date.now()}`,
        sessionId: `sess-${Date.now()}`
      });

      try {
        await driver.start();
        await driver.navigate(`${fixture.baseUrl}/reopen-needed`);

        await driver.navigateListingByHints({
          pathHints: ['카테고리'],
          maxPathSteps: 3
        });
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 180));

        const logs = await driver.navigateListingByHints({
          pathHints: ['여성스포츠의류'],
          maxPathSteps: 3
        });
        const summary = await driver.summarizeCurrentPage(3);

        expect(summary).toContain('/reopen-women');
        expect(
          logs.some((entry) => /navigation surface re-opened for non-root hop/i.test(entry.message))
        ).toBe(true);
      } finally {
        await driver.close();
        await fixture.close();
        await rm(screenshotRoot, { recursive: true, force: true });
      }
    },
    90000
  );
});
