const http = require('http');
const fs = require('fs');
const path = require('path');
const MIME = {'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.json':'application/json','.pdf':'application/pdf','.svg':'image/svg+xml'};
http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/webinar-followup') url = '/webinar-followup.html';
  if (url === '/') url = '/index.html';
  const fp = path.join(__dirname, 'public', url);
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream'});
    res.end(data);
  });
}).listen(3000, () => console.log('Static preview on http://localhost:3000'));
