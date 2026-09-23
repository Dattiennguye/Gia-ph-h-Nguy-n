import crypto from 'node:crypto';
import { config } from '../../config.js';

/**
 * MOMO — Ví điện tử, API v2
 *
 * Luồng: máy chủ gọi `/v2/gateway/api/create` để lấy `payUrl` → người dùng
 * thanh toán trên app MoMo → MoMo gọi `ipnUrl` máy-tới-máy để báo kết quả.
 * Giống VNPay, `redirectUrl` chỉ để hiển thị, IPN mới là nguồn sự thật.
 *
 * Chữ ký: HMAC SHA-256 trên chuỗi `key=value` nối bằng `&`, các khoá xếp theo
 * bảng chữ cái. Quy tắc này đúng cho cả lúc tạo giao dịch lẫn lúc kiểm tra IPN,
 * chỉ khác ở tập trường tham gia ký.
 */

/** Dựng chuỗi ký từ đúng tập trường được liệt kê, theo thứ tự bảng chữ cái. */
export function rawSignature(fields) {
  return Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k] ?? ''}`)
    .join('&');
}

export function sign(fields, secret = config.payment.momo.secretKey) {
  return crypto.createHmac('sha256', secret).update(rawSignature(fields), 'utf8').digest('hex');
}

/** Các trường tham gia ký khi TẠO giao dịch. */
const CREATE_FIELDS = [
  'accessKey', 'amount', 'extraData', 'ipnUrl', 'orderId',
  'orderInfo', 'partnerCode', 'redirectUrl', 'requestId', 'requestType',
];

/** Các trường tham gia ký trong IPN mà MoMo gửi về. */
const IPN_FIELDS = [
  'accessKey', 'amount', 'extraData', 'message', 'orderId', 'orderInfo',
  'orderType', 'partnerCode', 'payType', 'requestId', 'responseTime',
  'resultCode', 'transId',
];

const pick = (source, keys) => Object.fromEntries(keys.map((k) => [k, source[k] ?? '']));

/**
 * Tạo giao dịch, trả về địa chỉ để chuyển người dùng sang.
 * @returns {Promise<{payUrl:string, deeplink:string|null, orderId:string}>}
 */
export async function createPayment({ orderId, amountVnd, orderInfo, redirectUrl, ipnUrl, extraData = '' }) {
  const { partnerCode, accessKey, secretKey, endpoint, requestType } = config.payment.momo;
  if (!partnerCode || !accessKey || !secretKey) {
    throw new Error('Thiếu MOMO_PARTNER_CODE, MOMO_ACCESS_KEY hoặc MOMO_SECRET_KEY');
  }

  const requestId = `${orderId}-${Date.now()}`;
  const body = {
    partnerCode,
    accessKey,
    requestId,
    amount: String(Math.round(amountVnd)),
    orderId,
    orderInfo,
    redirectUrl,
    ipnUrl,
    extraData,
    requestType,
    lang: 'vi',
  };
  body.signature = sign(pick(body, CREATE_FIELDS), secretKey);

  const res = await fetch(`${endpoint}/v2/gateway/api/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  const data = await res.json().catch(() => ({}));
  // MoMo trả HTTP 200 kèm resultCode khác 0 khi thất bại — phải xét resultCode,
  // không chỉ xét mã HTTP.
  if (!res.ok || Number(data.resultCode) !== 0) {
    throw new Error(`MoMo: ${data.message ?? `lỗi ${res.status}`} (resultCode=${data.resultCode})`);
  }

  return { payUrl: data.payUrl, deeplink: data.deeplink ?? null, orderId, requestId };
}

/**
 * Kiểm tra IPN của MoMo.
 * @returns {{valid:boolean, success:boolean, orderId:string, amountVnd:number, reason:string}}
 */
export function verifyIpn(payload) {
  const { accessKey, secretKey } = config.payment.momo;
  // MoMo không gửi lại accessKey trong IPN — lấy từ cấu hình của mình.
  const fields = { ...pick(payload, IPN_FIELDS), accessKey };
  const expected = sign(fields, secretKey);
  const received = String(payload.signature ?? '');

  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  const success = valid && Number(payload.resultCode) === 0;

  return {
    valid,
    success,
    orderId: payload.orderId ?? null,
    amountVnd: payload.amount != null ? Number(payload.amount) : null,
    transId: payload.transId ?? null,
    resultCode: payload.resultCode,
    reason: !valid ? 'Chữ ký không hợp lệ' : success ? 'Thành công' : payload.message || `Thất bại (resultCode=${payload.resultCode})`,
  };
}
