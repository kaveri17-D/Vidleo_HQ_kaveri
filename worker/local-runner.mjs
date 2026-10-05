import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import worker from './dist/index.js';

// Auto-load backend/.env for secret alignment
try {
  const envPath = path.resolve(process.cwd(), 'backend/.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = match[2] || '';
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
} catch (e) {
  console.warn('Could not load backend/.env:', e.message);
}

const PORT = parseInt(process.env.PORT || '8787', 10);
const env = {
  SIGNED_DOWNLOAD_SECRET: process.env.SIGNED_DOWNLOAD_SECRET || 'nexus-fallback-ticket-secret-key-change-in-prod',
  ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN || '*',
  MAX_RANGE_BYTES: process.env.MAX_RANGE_BYTES || 52428800,
  ALLOW_LOOPBACK_FOR_TEST: process.env.ALLOW_LOOPBACK_FOR_TEST || 'false',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1:' + PORT}`);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined) {
        if (Array.isArray(value)) {
          for (const v of value) headers.append(key, v);
        } else {
          headers.set(key, value);
        }
      }
    }

    const init = {
      method: req.method,
      headers
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = Readable.toWeb(req);
      init.duplex = 'half';
    }

    const request = new Request(url.toString(), init);
    const response = await worker.fetch(request, env);

    res.statusCode = response.status;
    response.headers.forEach((val, key) => {
      res.setHeader(key, val);
    });

    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } else {
      res.end();
    }
  } catch (err) {
    console.error('Local worker runner error:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Worker runner error', detail: err.message }));
    } else {
      res.end();
    }
  }
});

const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`NEXUS Worker local runner listening on http://${HOST}:${PORT}`);
});
