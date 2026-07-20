import { readFileSync } from 'node:fs';
const PASS = readFileSync(process.env.TEMP + '/zzscan.txt', 'utf8').trim();
const BASE = 'http://localhost:3000';
let jar: string[] = [];
const merge = (r: Response) => { jar = [...jar, ...(r.headers.getSetCookie?.() ?? [])]; };
const cookieHeader = () => jar.map(c => c.split(';')[0]).join('; ');

let r = await fetch(`${BASE}/api/auth/csrf`, { headers: { cookie: cookieHeader() } }); merge(r);
const token = (await r.json()).csrfToken;
r = await fetch(`${BASE}/api/auth/callback/credentials`, {
  method: 'POST',
  headers: { cookie: cookieHeader(), 'Content-Type': 'application/x-www-form-urlencoded', 'X-Auth-Return-Redirect': '1' },
  body: new URLSearchParams({ csrfToken: token, username: 'zz-scan', password: PASS, callbackUrl: BASE }),
  redirect: 'manual',
});
merge(r);
const session = jar.map(c => c.split(';')[0]).find(c => c.startsWith('authjs.session-token='));
console.log(session ?? 'NO SESSION');
