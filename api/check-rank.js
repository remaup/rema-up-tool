// api/check-rank.js (v4)
// 검색 범위 300위까지 + sim/date 둘 다 시도 + URL 매칭 강화

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'POST 요청만 허용됩니다' });
  }

  const { keyword, blogUrl } = req.body || {};

  if (!keyword || !blogUrl) {
    return res.status(400).json({ ok: false, error: '키워드와 블로그 주소가 모두 필요합니다' });
  }

  const blogId = extractBlogId(blogUrl);
  if (!blogId) {
    return res.status(400).json({
      ok: false,
      error: '올바른 네이버 블로그 주소가 아닙니다. 예: https://blog.naver.com/your_id',
    });
  }

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).json({
      ok: false,
      error: '서버에 네이버 API 키가 설정되지 않았습니다.',
    });
  }

  const headers = {
    'X-Naver-Client-Id': clientId,
    'X-Naver-Client-Secret': clientSecret,
  };

  // 정렬 방식 두 개 다 시도 (sim: 유사도, date: 최신순)
  // 최대 300위까지 (페이지당 100, 3페이지)
  const sortModes = ['sim', 'date'];
  const results = {}; // { sim: rank, date: rank }
  let topResult = null;
  let totalChecked = 0;

  try {
    for (const sort of sortModes) {
      let foundRank = null;
      let matchedItem = null;
      let pageTotal = 0;

      // 100개씩 3페이지 = 300위까지
      for (let start = 1; start <= 201; start += 100) {
        const apiUrl = `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(keyword)}&display=100&start=${start}&sort=${sort}`;

        const response = await fetch(apiUrl, { headers });

        if (!response.ok) {
          // 네이버는 start > total이면 400 반환 - 그건 그냥 결과 끝
          if (response.status === 400 && start > 1) break;
          const text = await response.text();
          return res.status(502).json({
            ok: false,
            error: `네이버 API 호출 실패 (HTTP ${response.status})`,
            detail: text.slice(0, 200),
          });
        }

        const data = await response.json();
        const items = Array.isArray(data.items) ? data.items : [];
        pageTotal += items.length;

        // 1위 블로그는 sim 정렬 첫 페이지 첫 항목으로 (실제 검색 결과 1위와 가장 유사)
        if (sort === 'sim' && start === 1 && items.length > 0 && !topResult) {
          topResult = {
            bloggername: stripHtmlTags(items[0].bloggername || ''),
            title: stripHtmlTags(items[0].title || ''),
            link: items[0].link || '',
          };
        }

        // 우리 블로그 매칭
        for (let i = 0; i < items.length; i++) {
          if (matchesBlogId(items[i].link, blogId)) {
            foundRank = start + i;
            matchedItem = items[i];
            break;
          }
        }

        if (foundRank) break; // 찾으면 더 안 봄
        if (items.length < 100) break; // 결과 끝
      }

      results[sort] = { rank: foundRank, matchedItem, totalChecked: pageTotal };
      totalChecked = Math.max(totalChecked, pageTotal);
    }

    // sim과 date 중 더 낮은 순위(=더 좋은 순위) 채택
    const simRank = results.sim?.rank;
    const dateRank = results.date?.rank;

    let bestRank = null;
    let bestItem = null;
    let bestSort = null;

    if (simRank && dateRank) {
      if (simRank <= dateRank) {
        bestRank = simRank; bestItem = results.sim.matchedItem; bestSort = 'sim';
      } else {
        bestRank = dateRank; bestItem = results.date.matchedItem; bestSort = 'date';
      }
    } else if (simRank) {
      bestRank = simRank; bestItem = results.sim.matchedItem; bestSort = 'sim';
    } else if (dateRank) {
      bestRank = dateRank; bestItem = results.date.matchedItem; bestSort = 'date';
    }

    if (bestRank) {
      return res.status(200).json({
        ok: true,
        found: true,
        rank: bestRank,
        blogTitle: stripHtmlTags(bestItem.bloggername || ''),
        postTitle: stripHtmlTags(bestItem.title || ''),
        matchedUrl: bestItem.link || '',
        totalChecked,
        topResult,
        debug: { simRank, dateRank, bestSort },
      });
    } else {
      return res.status(200).json({
        ok: true,
        found: false,
        rank: null,
        message: `상위 ${totalChecked}위 내에서 발견되지 않았습니다 (sim+date 모두 검색)`,
        totalChecked,
        topResult,
        debug: { simRank, dateRank },
      });
    }
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: '서버 오류: ' + (err.message || String(err)),
    });
  }
}

// 블로그 URL에서 ID 추출
function extractBlogId(url) {
  if (!url) return null;
  const s = String(url).trim();
  // https://blog.naver.com/USER_ID 또는 blog.naver.com/USER_ID 형식
  const m = s.match(/blog\.naver\.com\/([a-zA-Z0-9_\-]+)/i);
  return m ? m[1] : null;
}

// URL이 해당 blogId의 글인지 확인 - 강화된 매칭
function matchesBlogId(link, blogId) {
  if (!link || !blogId) return false;
  const target = blogId.toLowerCase();
  const url = String(link).toLowerCase();

  // 패턴 1: blog.naver.com/USER_ID/POST_ID
  if (url.includes(`blog.naver.com/${target}/`)) return true;
  // 패턴 2: blog.naver.com/USER_ID (끝)
  if (url.match(new RegExp(`blog\\.naver\\.com\\/${target}($|\\?|#)`))) return true;
  // 패턴 3: 모바일 m.blog.naver.com
  if (url.includes(`m.blog.naver.com/${target}/`)) return true;
  if (url.match(new RegExp(`m\\.blog\\.naver\\.com\\/${target}($|\\?|#)`))) return true;
  // 패턴 4: PostView 등 ?blogId=USER_ID
  if (url.match(new RegExp(`[?&]blogId=${target}($|&)`))) return true;

  return false;
}

// HTML 태그 제거 (네이버 API는 <b> 태그 등을 포함)
function stripHtmlTags(s) {
  if (!s) return '';
  return String(s).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
