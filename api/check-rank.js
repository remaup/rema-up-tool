// api/check-rank.js (v3)
// 네이버 블로그 검색으로 우리 블로그 순위 + 1위 블로그 정보 반환

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

  try {
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

    // 1위 블로그 정보
    const topResult = items.length > 0 ? {
      bloggername: stripHtmlTags(items[0].bloggername || ''),
      title: stripHtmlTags(items[0].title || ''),
      link: items[0].link || '',
    } : null;

    // 우리 블로그 순위 매칭
    const targetId = blogId.toLowerCase();
    let foundIndex = -1;
    let matchedItem = null;

    for (let i = 0; i < items.length; i++) {
      const link = String(items[i].link || '').toLowerCase();
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
        topResult,
      });
    } else {
      return res.status(200).json({
        ok: true,
        found: false,
        rank: null,
        message: `상위 ${items.length}위 내에서 발견되지 않았습니다`,
        totalChecked: items.length,
        topResult,
      });
    }
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: '조회 중 오류 발생: ' + (err.message || String(err)),
    });
  }
}

function extractBlogId(url) {
  if (!url) return null;
  let s = String(url).trim();
  s = s.replace(/^https?:\/\//i, '');
  s = s.replace(/^(www|m)\./i, '');
  const m = s.match(/blog\.naver\.com\/([^\/?#\s]+)/i);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]+$/.test(s)) return s;
  return null;
}

function stripHtmlTags(s) {
  if (!s) return '';
  return String(s)
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
