import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { useTempDb, startServer } from './helpers.js';

useTempDb('oauth');

/* --------------------------- bộ ký token giả, đóng vai nhà cung cấp -------- */

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

function makeRsaSigner(kid = 'rsa-key-1') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
  const sign = (claims, { header = {} } = {}) => {
    const h = b64({ alg: 'RS256', kid, typ: 'JWT', ...header });
    const p = b64(claims);
    const sig = crypto.sign('sha256', Buffer.from(`${h}.${p}`), privateKey);
    return `${h}.${p}.${sig.toString('base64url')}`;
  };
  return { jwk, sign, privateKey, publicKey };
}

function makeEcSigner(kid = 'ec-key-1') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig' };
  const sign = (claims) => {
    const h = b64({ alg: 'ES256', kid, typ: 'JWT' });
    const p = b64(claims);
    const sig = crypto.sign('sha256', Buffer.from(`${h}.${p}`), {
      key: privateKey, dsaEncoding: 'ieee-p1363',
    });
    return `${h}.${p}.${sig.toString('base64url')}`;
  };
  return { jwk, sign };
}

function jwksServer(keys) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ keys }));
  });
  return {
    listen: () => new Promise((r) => server.listen(0, r)),
    url: () => `http://127.0.0.1:${server.address().port}/keys`,
    close: () => new Promise((r) => server.close(r)),
  };
}

const future = () => Math.floor(Date.now() / 1000) + 600;
const past = () => Math.floor(Date.now() / 1000) - 600;

/* ------------------------------------------------------------------ tests */

let verifyIdToken, clearJwksCache, rsa, ec, jwks, JWKS_URL;
const ISS = 'https://accounts.google.com';
const AUD = 'vigo-match.apps.googleusercontent.com';

before(async () => {
  ({ verifyIdToken, clearJwksCache } = await import('../src/lib/jwt.js'));
  rsa = makeRsaSigner();
  ec = makeEcSigner();
  jwks = jwksServer([rsa.jwk, ec.jwk]);
  await jwks.listen();
  JWKS_URL = jwks.url();
});
after(async () => { await jwks.close(); });

const opts = () => ({ jwksUrl: JWKS_URL, issuer: ISS, audience: [AUD] });
const goodClaims = (over = {}) => ({
  iss: ISS, aud: AUD, sub: 'user-123', email: 'a@example.com',
  email_verified: true, exp: future(), iat: Math.floor(Date.now() / 1000), ...over,
});

describe('Token hợp lệ', () => {
  test('chấp nhận token RS256 đúng chuẩn', async () => {
    const claims = await verifyIdToken(rsa.sign(goodClaims()), opts());
    assert.equal(claims.sub, 'user-123');
    assert.equal(claims.email, 'a@example.com');
  });

  test('chấp nhận token ES256 — Apple có thể dùng khoá EC', async () => {
    const claims = await verifyIdToken(ec.sign(goodClaims()), opts());
    assert.equal(claims.sub, 'user-123');
  });

  test('chấp nhận aud dạng mảng miễn là có chứa client id của mình', async () => {
    const claims = await verifyIdToken(rsa.sign(goodClaims({ aud: ['app-khac', AUD] })), opts());
    assert.equal(claims.sub, 'user-123');
  });

  test('chấp nhận một trong nhiều client id đã cấu hình', async () => {
    const claims = await verifyIdToken(rsa.sign(goodClaims({ aud: 'ios-client-id' })), {
      ...opts(), audience: ['web-client-id', 'ios-client-id'],
    });
    assert.equal(claims.sub, 'user-123');
  });
});

describe('Chống chiếm tài khoản qua token của ứng dụng khác', () => {
  test('TỪ CHỐI token được cấp cho ứng dụng khác — lỗ hổng chính', async () => {
    const tokenOfAnotherApp = rsa.sign(goodClaims({ aud: 'ung-dung-khac.apps.googleusercontent.com' }));
    await assert.rejects(
      () => verifyIdToken(tokenOfAnotherApp, opts()),
      /cấp cho một ứng dụng khác/,
      'token hợp lệ của app khác KHÔNG được đăng nhập vào đây'
    );
  });

  test('từ chối khi chưa cấu hình client id — không âm thầm chấp nhận tất cả', async () => {
    await assert.rejects(
      () => verifyIdToken(rsa.sign(goodClaims()), { ...opts(), audience: [] }),
      /Chưa cấu hình client id/
    );
  });

  test('từ chối token do nhà cung cấp khác phát hành', async () => {
    await assert.rejects(
      () => verifyIdToken(rsa.sign(goodClaims({ iss: 'https://ke-tan-cong.example' })), opts()),
      /không phải/
    );
  });
});

describe('Chống giả mạo chữ ký', () => {
  test('từ chối alg "none"', async () => {
    const h = b64({ alg: 'none', kid: rsa.jwk.kid, typ: 'JWT' });
    const p = b64(goodClaims());
    await assert.rejects(() => verifyIdToken(`${h}.${p}.`, opts()), /không hợp lệ/);
  });

  test('từ chối đổi RS256 thành HS256 rồi ký bằng chính khoá công khai', async () => {
    const pubPem = rsa.publicKey.export({ type: 'spki', format: 'pem' });
    const h = b64({ alg: 'HS256', kid: rsa.jwk.kid, typ: 'JWT' });
    const p = b64(goodClaims());
    const sig = crypto.createHmac('sha256', pubPem).update(`${h}.${p}`).digest('base64url');
    await assert.rejects(
      () => verifyIdToken(`${h}.${p}.${sig}`, opts()),
      /không hợp lệ cho khoá này/
    );
  });

  test('từ chối token bị sửa nội dung sau khi ký', async () => {
    const token = rsa.sign(goodClaims());
    const [h, , s] = token.split('.');
    const tampered = `${h}.${b64(goodClaims({ sub: 'ke-tan-cong' }))}.${s}`;
    await assert.rejects(() => verifyIdToken(tampered, opts()), /Chữ ký token không hợp lệ/);
  });

  test('từ chối token ký bằng khoá lạ', async () => {
    const other = makeRsaSigner(rsa.jwk.kid); // cùng kid nhưng khác khoá
    await assert.rejects(() => verifyIdToken(other.sign(goodClaims()), opts()), /Chữ ký token không hợp lệ/);
  });

  test('từ chối kid không có trong JWKS', async () => {
    clearJwksCache();
    const unknown = makeRsaSigner('kid-la-hoac');
    await assert.rejects(() => verifyIdToken(unknown.sign(goodClaims()), opts()), /Không tìm thấy khoá/);
  });
});

describe('Kiểm tra thời gian', () => {
  test('từ chối token hết hạn', async () => {
    await assert.rejects(() => verifyIdToken(rsa.sign(goodClaims({ exp: past() })), opts()), /hết hạn/);
  });

  test('từ chối token phát hành ở tương lai', async () => {
    await assert.rejects(
      () => verifyIdToken(rsa.sign(goodClaims({ iat: future() + 600 })), opts()),
      /tương lai/
    );
  });

  test('từ chối token thiếu sub', async () => {
    const claims = goodClaims(); delete claims.sub;
    await assert.rejects(() => verifyIdToken(rsa.sign(claims), opts()), /thiếu định danh/);
  });
});

describe('Đăng nhập qua API', () => {
  let api;
  before(async () => { api = await startServer(); });
  after(async () => { await api.close(); });

  test('từ chối nhà cung cấp không hỗ trợ', async () => {
    const r = await api.post('/auth/oauth', { provider: 'facebook', identity_token: 'x' });
    assert.equal(r.status, 400);
  });

  test('báo rõ khi máy chủ chưa cấu hình client id', async () => {
    const r = await api.post('/auth/oauth', { provider: 'apple', identity_token: 'a.b.c' });
    assert.equal(r.status, 401);
    assert.match(r.data.message, /Chưa cấu hình|client id/i);
  });

  test('lối vào dev tạo được tài khoản khi không phải môi trường thật', async () => {
    const r = await api.post('/auth/oauth', {
      provider: 'google', dev_subject: 'google-sub-1', dev_email: 'dev@test.vn', dev_name: 'Người Dev',
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.created, true);
    assert.ok(r.data.token);

    // Lần sau phải nhận ra cùng một người, không tạo tài khoản mới.
    const again = await api.post('/auth/oauth', {
      provider: 'google', dev_subject: 'google-sub-1', dev_email: 'dev@test.vn',
    });
    assert.equal(again.data.created, false);
    assert.equal(again.data.user.id, r.data.user.id);
  });
});
