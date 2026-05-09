// api/check-rank.js
// 네이버 블로그 검색 API로 특정 블로그의 키워드 순위를 조회합니다.
// Vercel Serverless Function (Node.js 18+)

export default async function handler(req, res) {
  // 메서드 체크
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'POST 요청만 허용됩니다' });
  }

  // 입력 받기
  const { keyword, blogUrl } = req.body || {};

  if (!keyword || !blogUrl) {
    return res.status(400).json({ ok: false, error: '키워드와 블로그 주소가 모두 필요합니다' });
  }

  // 블로그 ID 추출
  const blogId = extractBlogId(blogUrl);
  if (!blogId) {
    return res.status(400).json({
      ok: false,
      error: '올바른 네이버 블로그 주소가 아닙니다. 예: https://blog.naver.com/your_id',
    });
  }

  // API 키 확인
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).json({
      ok: false,
      error: '서버에 네이버 API 키가 설정되지 않았습니다. Vercel 환경변수 NAVER_CLIENT_ID, NAVER_CLIENT_SECRET을 확인하세요.',
    });
  }

  try {
    // 네이버 블로그 검색 API 호출 (display 최대 100)
    const apiUrl = `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(
      keyword
    )}&display=100&start=1&sort=sim`;

    const response = await fetch(apiUrl, {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(502).json({
        ok: false,
        error: `네이버 API 호출 실패 (HTTP ${response.status})`,
        detail: text.slice(0, 200),
      });
    }

    const data = await response.json();
    const items = Array.isArray(data.items) ? data.items : [];

    // 매칭 검사
    const targetId = blogId.toLowerCase();
    let foundIndex = -1;
    let matchedItem = null;

    for (let i = 0; i < items.length; i++) {
      const link = String(items[i].link || '').toLowerCase();
      // blog.naver.com/USERID 패턴 매칭 (m. 서브도메인 포함)
      if (
        link.includes(`blog.naver.com/${targetId}/`) ||
        link.endsWith(`blog.naver.com/${targetId}`)
      ) {
        foundIndex = i;
        matchedItem = items[i];
        break;
      }
    }

    if (foundIndex >= 0) {
      return res.status(200).json({
        ok: true,
        found: true,
        rank: foundIndex + 1,
        blogTitle: stripHtmlTags(matchedItem.bloggername || ''),
        postTitle: stripHtmlTags(matchedItem.title || ''),
        matchedUrl: matchedItem.link || '',
        totalChecked: items.length,
      });
    } else {
      return res.status(200).json({
        ok: true,
        found: false,
        rank: null,
        message: `상위 ${items.length}위 내에서 발견되지 않았습니다`,
        totalChecked: items.length,
      });
    }
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: '조회 중 오류 발생: ' + (err.message || String(err)),
    });
  }
}

// 다양한 형태의 입력에서 블로그 ID 추출
// 지원: https://blog.naver.com/abc123, blog.naver.com/abc123, m.blog.naver.com/abc123, abc123 단독
function extractBlogId(url) {
  if (!url) return null;
  let s = String(url).trim();

  // 프로토콜 제거
  s = s.replace(/^https?:\/\//i, '');
  // m. / www. 제거
  s = s.replace(/^(www|m)\./i, '');

  // blog.naver.com/USERID 매칭
  const m = s.match(/blog\.naver\.com\/([^\/?#\s]+)/i);
  if (m) return m[1];

  // 단순 ID로 입력한 경우 (영숫자, 언더스코어, 하이픈)
  if (/^[a-zA-Z0-9_-]+$/.test(s)) return s;

  return null;
}

// HTML 태그 제거 (네이버 API는 검색어를 <b> 태그로 감싸서 반환함)
function stripHtmlTags(s) {
  if (!s) return '';
  return String(s).replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
