import crypto from 'node:crypto';
import { config } from '../../config.js';

/**
 * VNPAY — Cổng thanh toán, phiên bản 2.1.0
 *
 * Luồng: máy chủ dựng một URL đã ký → người dùng được chuyển sang VNPay →
 * thanh toán xong VNPay gọi về hai nơi:
 *
 *   - `vnp_ReturnUrl`  (trình duyệt người dùng quay lại): CHỈ để hiển thị.
 *     Người dùng có thể sửa tham số trên thanh địa chỉ, nên tuyệt đối không
 *     dùng lối này để cộng tiền.
 *   - `vnp_IpnUrl`     (VNPay gọi máy-tới-máy): đây mới là nguồn sự thật.
 *
 * Chữ ký: sắp xếp tham số theo bảng chữ cái, nối thành chuỗi truy vấn, HMAC
 * SHA-512 bằng mã bí mật, viết thường dạng hex. Hai trường `vnp_SecureHash` và
 * `vnp_SecureHashType` không tham gia vào chuỗi ký.
 */

/**
 * Chuỗi dùng để ký.
 *
 * Cách mã hoá giá trị là chỗ sai phổ biến nhất khi tích hợp VNPay: bản demo cũ
 * nối chuỗi KHÔNG mã hoá, bản 2.1.0 hiện hành thì mã hoá (khoảng trắng thành
 * dấu `+`). Hai bên phải dùng cùng một cách, nên chỗ này để cấu hình được, và
 * cả lúc ký lẫn lúc kiểm tra đều đi qua đúng hàm này.
 */
export function signData(params, { encode = config.payment.vnpay.encodeHash } = {}) {
  const entries = Object.entries(params)
    .filter(([k, v]) => k !== 'vnp_SecureHash' && k !== 'vnp_SecureHashType')
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const enc = (s) => encodeURIComponent(String(s)).replace(/%20/g, '+');
  return entries.map(([k, v]) => `${enc(k)}=${encode ? enc(v) : String(v)}`).join('&');
}

export function sign(params, secret = config.payment.vnpay.hashSecret) {
  return crypto.createHmac('sha512', secret).update(signData(params), 'utf8').digest('hex');
}

/** Thời gian theo múi giờ Việt Nam, định dạng yyyyMMddHHmmss mà VNPay yêu cầu. */
export function vnpTime(date = new Date()) {
  const vn = new Date(date.getTime() + 7 * 3600 * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${vn.getUTCFullYear()}${p(vn.getUTCMonth() + 1)}${p(vn.getUTCDate())}` +
    `${p(vn.getUTCHours())}${p(vn.getUTCMinutes())}${p(vn.getUTCSeconds())}`
  );
}

/**
 * Dựng URL thanh toán.
 * @param {object} o
 * @param {string} o.txnRef     mã giao dịch của mình, phải duy nhất
 * @param {number} o.amountVnd  số tiền, đơn vị đồng
 * @param {string} o.orderInfo  mô tả đơn hàng
 * @param {string} o.ipAddr     địa chỉ IP người thanh toán
 * @param {string} o.returnUrl  nơi trình duyệt quay lại
 */
export function buildPaymentUrl({ txnRef, amountVnd, orderInfo, ipAddr, returnUrl, locale = 'vn', expireMinutes = 15 }) {
  const { tmnCode, hashSecret, payUrl } = config.payment.vnpay;
  if (!tmnCode || !hashSecret) throw new Error('Thiếu VNPAY_TMN_CODE hoặc VNPAY_HASH_SECRET');

  const now = new Date();
  const params = {
    vnp_Version: '2.1.0',
    vnp_Command: 'pay',
    vnp_TmnCode: tmnCode,
    // VNPay tính tiền theo đơn vị nhỏ nhất: số tiền nhân 100.
    vnp_Amount: String(Math.round(amountVnd) * 100),
    vnp_CurrCode: 'VND',
    vnp_TxnRef: txnRef,
    vnp_OrderInfo: orderInfo,
    vnp_OrderType: 'other',
    vnp_Locale: locale,
    vnp_ReturnUrl: returnUrl,
    vnp_IpAddr: ipAddr || '127.0.0.1',
    vnp_CreateDate: vnpTime(now),
    vnp_ExpireDate: vnpTime(new Date(now.getTime() + expireMinutes * 60000)),
  };

  const secureHash = sign(params);
  // Chuỗi trên URL phải mã hoá giống hệt chuỗi đã ký, nếu không VNPay báo sai chữ ký.
  return `${payUrl}?${signData(params, { encode: true })}&vnp_SecureHash=${secureHash}`;
}

/**
 * Kiểm tra dữ liệu VNPay gửi về (cả returnUrl lẫn IPN).
 * @returns {{valid:boolean, success:boolean, txnRef:string, amountVnd:number, reason:string}}
 */
export function verifyCallback(query) {
  const received = String(query.vnp_SecureHash ?? '');
  const expected = sign(query);

  const a = Buffer.from(received.toLowerCase());
  const b = Buffer.from(expected.toLowerCase());
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);

  // Giao dịch chỉ thành công khi CẢ HAI mã đều là "00". Chỉ xét vnp_ResponseCode
  // là chưa đủ — có trường hợp mã phản hồi ổn nhưng trạng thái giao dịch thì không.
  const success =
    valid && query.vnp_ResponseCode === '00' && query.vnp_TransactionStatus === '00';

  return {
    valid,
    success,
    txnRef: query.vnp_TxnRef ?? null,
    amountVnd: query.vnp_Amount ? Number(query.vnp_Amount) / 100 : null,
    bankCode: query.vnp_BankCode ?? null,
    transactionNo: query.vnp_TransactionNo ?? null,
    responseCode: query.vnp_ResponseCode ?? null,
    reason: !valid
      ? 'Chữ ký không hợp lệ'
      : success
        ? 'Thành công'
        : RESPONSE_CODES[query.vnp_ResponseCode] ?? `Giao dịch không thành công (mã ${query.vnp_ResponseCode})`,
  };
}

/** Một số mã phản hồi thường gặp, để hiển thị bằng tiếng Việt cho người dùng. */
const RESPONSE_CODES = {
  '00': 'Thành công',
  '07': 'Giao dịch bị nghi ngờ gian lận',
  '09': 'Thẻ/Tài khoản chưa đăng ký dịch vụ InternetBanking',
  '10': 'Xác thực thông tin thẻ/tài khoản không đúng quá 3 lần',
  '11': 'Đã hết hạn chờ thanh toán',
  '12': 'Thẻ/Tài khoản bị khoá',
  '13': 'Nhập sai mật khẩu xác thực giao dịch (OTP)',
  24: 'Khách hàng huỷ giao dịch',
  51: 'Tài khoản không đủ số dư',
  65: 'Tài khoản đã vượt quá hạn mức giao dịch trong ngày',
  75: 'Ngân hàng thanh toán đang bảo trì',
  79: 'Nhập sai mật khẩu thanh toán quá số lần quy định',
  99: 'Lỗi không xác định',
};
