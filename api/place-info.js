// api/place-info.js (v3) - 다중 엔드포인트 + 강화 추출

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'POST만 허용' });
  }

  const { placeId } = req.body || {};
  if (!placeId) {
    return res.status(400).json({ ok: false, error: '플레이스 번호를 입력해주세요' });
  }

  const debug = { attempts: [] };
  let cleanedId = extractPlaceId(placeId);

  // 단축/일반 URL이면 redirect 따라가기
  if (!cleanedId && /^https?:\/\//i.test(placeId.trim())) {
    try {
      const r = await fetch(placeId.trim(), {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        redirect: 'follow',
      });
      const m = (r.url || '').match(/\/(\d{6,})/);
      if (m) cleanedId = m[1];
      debug.attempts.push({ step: 'redirect', finalUrl: (r.url||'').slice(0,150) });
    } catch (e) {
      debug.attempts.push({ step: 'redirect-error', error: String(e.message) });
    }
  }

  if (!cleanedId) {
    return res.status(400).json({
      ok: false,
      error: '플레이스 ID 추출 실패',
      debug,
    });
  }

  // 다중 엔드포인트 시도
  const endpoints = [
    { url: `https://m.place.naver.com/hospital/${cleanedId}/home`, ua: 'mobile' },
    { url: `https://m.place.naver.com/place/${cleanedId}/home`, ua: 'mobile' },
    { url: `https://m.place.naver.com/restaurant/${cleanedId}/home`, ua: 'mobile' },
    { url: `https://m.place.naver.com/beautysalon/${cleanedId}/home`, ua: 'mobile' },
    { url: `https://pcmap.place.naver.com/hospital/${cleanedId}/home`, ua: 'desktop' },
    { url: `https://pcmap.place.naver.com/place/${cleanedId}/home`, ua: 'desktop' },
  ];

  let result = null;
  for (const ep of endpoints) {
    const ua = ep.ua === 'mobile'
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    try {
      const r = await fetch(ep.url, {
        headers: {
          'User-Agent': ua,
          'Accept-Language': 'ko-KR,ko;q=0.9',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
      });
      const html = r.ok ? await r.text() : '';
      const att = { url: ep.url.replace(`/${cleanedId}/home`, '/.../home'), status: r.status, len: html.length };

      if (html && html.length > 500) {
        const ext = extractFromHtml(html);
        att.found = { name: !!ext.name, addr: !!ext.address, cat: !!ext.category };
        if (ext.name) {
          result = ext;
          debug.success = ep.url;
          debug.attempts.push(att);
          break;
        }
      }
      debug.attempts.push(att);
    } catch (e) {
      debug.attempts.push({ url: ep.url.slice(0,80), error: String(e.message).slice(0,150) });
    }
  }

  if (!result || !result.name) {
    return res.status(404).json({
      ok: false,
      error: '플레이스 정보 추출 실패 — 수동 입력 필요',
      debug: { ...debug, placeId: cleanedId },
    });
  }

  return res.status(200).json({
    ok: true,
    placeId: cleanedId,
    name: result.name,
    address: result.address || '',
    category: result.category || '',
    phone: result.phone || '',
  });
}

function extractPlaceId(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (/naver\.me\//i.test(s)) return null;
  const m = s.match(/(\d{6,})/);
  return m ? m[1] : null;
}

function extractFromHtml(html) {
  let name = null, address = null, category = null, phone = null;

  // og:title (가장 안정적)
  const og = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
  if (og) {
    name = og[1].replace(/\s*[:\-—|]\s*네이버.*$/i, '').replace(/\s*::\s*.*$/i, '').trim();
  }

  // title 태그 fallback
  if (!name) {
    const t = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (t) name = t[1].replace(/\s*[:\-—|]\s*네이버.*$/i, '').trim();
  }

  // JSON-LD 구조화 데이터
  const jsonLds = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of jsonLds) {
    try {
      const obj = JSON.parse(m[1].trim());
      const o = Array.isArray(obj) ? obj[0] : obj;
      if (o) {
        if (!name && o.name) name = o.name;
        if (!address && o.address) {
          address = typeof o.address === 'string' ? o.address : (o.address.streetAddress || o.address.addressLocality || null);
        }
        if (!phone && o.telephone) phone = o.telephone;
      }
    } catch (e) { /* skip */ }
  }

  // 임베디드 JSON
  if (!address) {
    const m = html.match(/"roadAddress"\s*:\s*"([^"]+)"/);
    if (m) address = unicode(m[1]);
  }
  if (!address) {
    const m = html.match(/"address"\s*:\s*"([^"]+)"/);
    if (m) address = unicode(m[1]);
  }

  const c = html.match(/"category"\s*:\s*"([^"]+)"/);
  if (c) category = unicode(c[1]);

  const p = html.match(/"phone"\s*:\s*"([^"]+)"/);
  if (p) phone = p[1];

  // 마지막 fallback - businessName
  if (!name) {
    const b = html.match(/"businessName"\s*:\s*"([^"]+)"/);
    if (b) name = unicode(b[1]);
  }

  return { name, address, category, phone };
}

function unicode(s) {
  if (!s) return '';
  try {
    return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, c) => String.fromCharCode(parseInt(c, 16)));
  } catch { return s; }
}
