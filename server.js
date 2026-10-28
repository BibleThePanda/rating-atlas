import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = Number(process.env.PORT || 3000);
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'};
createServer(async (req,res) => {
  const sendJson = (status, data) => {res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(405,{error:'Method not allowed'});
  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; } catch {return sendJson(400,{error:'Invalid URL'});}
  if (pathname === '/api/health') return sendJson(200,{ok:true,app:'Rating Atlas'});
  if (pathname.startsWith('/api/ratings/')) return sendJson(503,{code:'PERMISSION_REQUIRED',error:'Automatic AOTY access is unavailable: the site restricts automated scraping without permission. Use Import CSV/JSON to explore your ratings. No data was fetched.'});
  if (pathname.startsWith('/api/')) return sendJson(404,{error:'Endpoint not found'});
  const relative=pathname==='/'?'index.html':decodeURIComponent(pathname).replace(/^\/+/, '');
  const full=path.resolve(root,relative);
  if (full !== root && !full.startsWith(root + path.sep)) return sendJson(403,{error:'Forbidden'});
  try {
    if (!(await stat(full)).isFile()) return sendJson(404,{error:'Not found'});
    const data=await readFile(full);
    res.writeHead(200,{'Content-Type':types[path.extname(full)]||'application/octet-stream','Content-Length':data.length,'X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=300'});
    res.end(req.method==='HEAD'?undefined:data);
  } catch {sendJson(404,{error:'File not found'});}
}).listen(PORT,'0.0.0.0',()=>console.log('Rating Atlas listening on port '+PORT));
