// MeshOk API worker: HTML from KV, upload API with TTL links (KV auto-expiry)
const TTL_MAX = 365*24*3600;
const j = (o, s, c) => new Response(JSON.stringify(o), {status: s || 200, headers: Object.assign({'content-type':'application/json'}, c || {})});
const cors = () => ({'access-control-allow-origin':'*','access-control-allow-headers':'content-type,x-ttl,x-name','access-control-allow-methods':'GET,POST,DELETE,OPTIONS'});
const RE_ID = /^[A-Za-z0-9_-]{8,32}$/;
const newId = () => btoa(String.fromCharCode.apply(null, crypto.getRandomValues(new Uint8Array(9)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const secs = () => Math.floor(Date.now() / 1000);

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname;
    const c = cors();
    if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers: c});
    if (req.method === 'GET') {
      if (p === '/' || p === '/index.html' || p === '/u') {
        const html = await env.BUCKET.get('index.html');
        if (!html) return j({error: 'html missing'}, 500, c);
        return new Response(html, {headers: {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'}});
      }
      let m = p.match(/^\/u\/([A-Za-z0-9_-]{8,32})$/);
      if (m) return Response.redirect(url.origin + '/?u=' + m[1], 302);
      m = p.match(/^\/api\/file\/([A-Za-z0-9_-]{8,32})$/);
      if (m) {
        const o = await env.BUCKET.getWithMetadata(m[1], 'arrayBuffer');
        if (!o.value) return j({error: 'not found'}, 404, c);
        const h = {'access-control-allow-origin':'*'};
        h['content-type'] = (o.metadata && o.metadata.ct) || 'application/octet-stream';
        const nm = o.metadata && o.metadata.name;
        if (nm) h['content-disposition'] = 'inline; filename="' + nm.replace(/"/g, '') + '"';
        return new Response(o.value, {headers: h});
      }
      if (p === '/api/health') return j({ok: true}, 200, c);
    }
    if (req.method === 'POST' && p === '/api/upload') {
      let ttl = Number(req.headers.get('x-ttl') || 86400);
      if (!ttl || ttl < 3600) ttl = 3600;
      if (ttl > TTL_MAX) ttl = TTL_MAX;
      const body = await req.arrayBuffer();
      if (!body.byteLength) return j({error: 'empty'}, 400, c);
      if (body.byteLength > 24 * 1024 * 1024) return j({error: 'too large'}, 413, c);
      const key = newId();
      const raw = req.headers.get('x-name') || 'model';
      const name = raw.replace(/[^\w .\-\u0400-\u04FF]/g, '').slice(0, 120) || 'model';
      const ct = req.headers.get('content-type') || 'application/octet-stream';
      await env.BUCKET.put(key, body, {expirationTtl: ttl, metadata: {name: name, ct: ct, expires: String(secs() + ttl)}});
      return j({id: key, url: url.origin + '/u/' + key, expires: secs() + ttl}, 200, c);
    }
    if (req.method === 'POST' && p === '/api/index') {
      const ex = await env.BUCKET.get('index.html');
      if (ex) return j({error: 'exists'}, 409, c);
      const body = await req.arrayBuffer();
      if (!body.byteLength) return j({error: 'empty'}, 400, c);
      await env.BUCKET.put('index.html', body);
      return j({ok: true, bytes: body.byteLength}, 200, c);
    }
    if (req.method === 'DELETE') {
      const m = p.match(/^\/api\/file\/([A-Za-z0-9_-]{8,32})$/);
      if (m) { await env.BUCKET.delete(m[1]); return j({ok: true}, 200, c); }
    }
    return j({error: 'not found'}, 404, c);
  }
};
