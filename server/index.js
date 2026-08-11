// Explicit static bundle entrypoint for production custom-domain serving.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/') url.pathname = '/index.html';
    let response = await env.ASSETS.fetch(new Request(url, request));
    if (response.status === 404 && url.pathname === '/index.html') {
      const fallback = new URL(request.url);
      fallback.pathname = '/dist/index.html';
      response = await env.ASSETS.fetch(new Request(fallback, request));
    }
    const type = response.headers.get('content-type') || '';
    if (!type.includes('text/html')) return response;
    let html = await response.text();
    if (request.headers.get('oai-authenticated-user-email')?.toLowerCase() === 'forceofnaturegenetics@gmail.com') html = html.replace('<head>', '<head><script>window.__northstarOwner=true</script>');
    html = html.replace('</body>', '<script src="/auth.js"></script></body>');
    return new Response(html, response);
  }
};
