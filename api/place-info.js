// api/place-info.js
// 네이버 플레이스 ID로 병원명/주소/카테고리 추출
// 공식 API가 없어 m.place.naver.com 페이지를 파싱합니다.
// 페이지 구조 변경 시 깨질 수 있어 여러 추출 전략을 시도합니다.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'POST 요청만 허용됩니다' });
  }

  const { placeId } = req.body || {};

  // 입력에서 숫자만 추출 (URL 통째로 붙여넣어도 동작)
  const cleaned = extractPlaceId(placeId);
  if (!cleaned) {
    return res.status(400).json({
      ok: false,
      error: '올바른 플레이스 ID 또는 URL을 입력해주세요. 예: 1234567890 또는 https://map.naver.com/p/entry/place/1234567890',
    });
  }

  try {
    // 모바일 페이지가 봇 차단이 덜 깐깐함
    const url = `https://m.place.naver.com/place/${cleaned}/home`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        error: `네이버 응답 오류 (HTTP ${response.status}). ID가 잘못됐거나 네이버 측 차단일 수 있습니다.`,
      });
    }

    const html = await response.text();

    // ===== 추출 전략 (여러 개 시도, 하나라도 성공하면 사용) =====
    let name = null;
    let address = null;
    let category = null;
    let phone = null;

    // 전략 1: og:title 메타 태그 (가장 안정적)
    const ogTitleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
    if (ogTitleMatch) {
      name = ogTitleMatch[1]
        .replace(/\s*[:\-—]\s*네이버.*$/i, '')
        .replace(/\s*::\s*.*$/i, '')
        .trim();
    }

    // 전략 2: 임베디드 JSON에서 도로명주소 (정확한 주소)
    const roadAddrMatch = html.match(/"roadAddress"\s*:\s*"([^"]+)"/);
    if (roadAddrMatch) {
      address = unicodeUnescape(roadAddrMatch[1]);
    }

    // 전략 3: 일반 주소 (도로명주소 없으면)
    if (!address) {
      const addrMatch = html.match(/"address"\s*:\s*"([^"]+)"/);
      if (addrMatch) address = unicodeUnescape(addrMatch[1]);
    }

    // 전략 4: og:description에서 주소 추출 (마지막 fallback)
    if (!address) {
      const ogDescMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
      if (ogDescMatch) {
        // og:description은 보통 "주소 · 전화 · 영업시간" 형태
        const parts = ogDescMatch[1].split(/\s*[·•]\s*/);
        // 주소처럼 보이는 부분 찾기 (시/도/구/동 키워드 포함)
        for (const part of parts) {
          if (/[시구동로]/.test(part) && part.length > 5) {
            address = part.trim();
            break;
          }
        }
      }
    }

    // 카테고리 (진료과 추정에 활용)
    const catMatch = html.match(/"category"\s*:\s*"([^"]+)"/);
    if (catMatch) category = unicodeUnescape(catMatch[1]);

    // 전화번호 (있으면 함께)
    const phoneMatch = html.match(/"phone"\s*:\s*"([^"]+)"/);
    if (phoneMatch) phone = phoneMatch[1];

    if (!name && !address) {
      return res.status(404).json({
        ok: false,
        error: '플레이스 정보를 찾을 수 없습니다. ID가 정확한지 확인해주세요.',
      });
    }

    return res.status(200).json({
      ok: true,
      placeId: cleaned,
      name: name || '',
      address: address || '',
      category: category || '',
      phone: phone || '',
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: '조회 실패: ' + (err.message || String(err)),
    });
  }
}

// 입력에서 플레이스 ID(숫자) 추출
// 지원: "1234567890", "https://map.naver.com/p/entry/place/1234567890",
//      "https://m.place.naver.com/place/1234567890/home" 등
function extractPlaceId(input) {
  if (!input) return null;
  const s = String(input).trim();
  // URL 형태에서 마지막 긴 숫자 부분 추출
  const m = s.match(/(\d{6,})/);
  return m ? m[1] : null;
}

// "\uXXXX" 형태의 유니코드 이스케이프 풀기 (JSON 임베디드 필드에서 발생)
function unicodeUnescape(s) {
  if (!s) return '';
  try {
    return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, code) =>
      String.fromCharCode(parseInt(code, 16))
    );
  } catch {
    return s;
  }
}
