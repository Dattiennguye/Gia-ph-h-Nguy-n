import { insert, run, now } from '../db/index.js';
import { config } from '../config.js';

/**
 * GỬI SMS
 *
 * Mỗi nhà cung cấp là một hàm nhận `{ to, text }` và trả về `{ ref }` khi thành
 * công, hoặc ném lỗi. Đổi nhà cung cấp chỉ là đổi một biến môi trường.
 *
 * Mọi lần gửi đều được ghi vào bảng `sms_messages`: khi người dùng báo "không
 * nhận được mã", đó là chỗ duy nhất trả lời được câu hỏi đã gửi hay chưa, gửi
 * lúc nào, nhà cung cấp trả về gì. NỘI DUNG TIN KHÔNG ĐƯỢC LƯU — nó chứa mã
 * OTP, và một bảng log chứa mã OTP là một cửa hậu.
 */

/* ------------------------------------------------------------ nhà cung cấp */

/** Chỉ in ra terminal. Dùng khi phát triển. */
async function sendViaConsole({ to, text }) {
  console.log(`\n  [SMS → ${to}] ${text}\n`);
  return { ref: `console-${now()}` };
}

/**
 * Twilio — https://api.twilio.com
 * POST /2010-04-01/Accounts/{AccountSid}/Messages.json
 * Xác thực HTTP Basic (AccountSid : AuthToken), thân tin dạng form-urlencoded.
 */
async function sendViaTwilio({ to, text }) {
  const { accountSid, authToken, from, baseUrl } = config.sms.twilio;
  if (!accountSid || !authToken || !from) {
    throw new Error('Thiếu TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN hoặc TWILIO_FROM');
  }

  const res = await fetch(
    `${baseUrl}/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: text }),
    }
  );

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Twilio ${res.status}: ${data.message ?? 'gửi thất bại'}`);
  }
  return { ref: data.sid ?? null };
}

/**
 * eSMS.vn — nhà cung cấp trong nước, dùng nhiều cho tin OTP.
 * POST /MainService.svc/json/SendMultipleMessage_V4_post_json/
 *
 * Lưu ý về mã trả về: `CodeResult === '100'` chỉ có nghĩa là eSMS đã NHẬN yêu
 * cầu, không có nghĩa là tin đã tới máy người nhận. Trạng thái giao hàng thật
 * phải tra riêng bằng SMSID.
 */
async function sendViaEsms({ to, text }) {
  const { apiKey, secretKey, brandname, smsType, baseUrl } = config.sms.esms;
  if (!apiKey || !secretKey) throw new Error('Thiếu ESMS_API_KEY hoặc ESMS_SECRET_KEY');

  // eSMS nhận số nội địa dạng 09..., không nhận tiền tố +84.
  const phone = to.startsWith('+84') ? `0${to.slice(3)}` : to;

  const res = await fetch(`${baseUrl}/MainService.svc/json/SendMultipleMessage_V4_post_json/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ApiKey: apiKey,
      SecretKey: secretKey,
      Phone: phone,
      Content: text,
      SmsType: smsType,
      ...(brandname ? { Brandname: brandname } : {}),
      IsUnicode: '0',
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`eSMS ${res.status}`);
  if (String(data.CodeResult) !== '100') {
    throw new Error(`eSMS CodeResult=${data.CodeResult}: ${data.ErrorMessage ?? 'gửi thất bại'}`);
  }
  return { ref: data.SMSID ?? null };
}

/** Webhook tự dựng — để nối nhà cung cấp khác mà không phải sửa code. */
async function sendViaWebhook({ to, text, purpose }) {
  const { webhookUrl, webhookToken } = config.sms;
  if (!webhookUrl) throw new Error('Thiếu SMS_WEBHOOK_URL');

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(webhookToken ? { Authorization: `Bearer ${webhookToken}` } : {}),
    },
    body: JSON.stringify({ to, text, purpose }),
  });
  if (!res.ok) throw new Error(`Webhook ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return { ref: data.id ?? data.ref ?? null };
}

const PROVIDERS = {
  console: sendViaConsole,
  twilio: sendViaTwilio,
  esms: sendViaEsms,
  http: sendViaWebhook,
};

export const availableProviders = Object.keys(PROVIDERS);

/* ------------------------------------------------------------------- gửi */

/**
 * Gửi một tin nhắn và ghi lại kết quả.
 *
 * Không ném lỗi ra ngoài: người dùng vừa bấm "gửi mã" không nên nhận lỗi 500 vì
 * nhà cung cấp SMS đang trục trặc. Thất bại được ghi lại, hàm trả về `ok:false`,
 * và người dùng được mời thử lại.
 *
 * Thử lại một lần với lỗi tạm thời (mạng, 5xx) — quá số đó thì vấn đề nằm ở
 * cấu hình hoặc tài khoản, thử thêm cũng vô ích.
 */
export async function sendSms({ to, text, purpose = 'otp' }) {
  const provider = config.sms.provider;
  const send = PROVIDERS[provider];

  const logId = insert(
    `INSERT INTO sms_messages (provider, destination, purpose, status, created_at)
     VALUES (?, ?, ?, 'pending', ?)`,
    [provider, to, purpose, now()]
  );

  if (!send) {
    const message = `Nhà cung cấp SMS không hợp lệ: "${provider}". Chọn một trong: ${availableProviders.join(', ')}`;
    run("UPDATE sms_messages SET status = 'failed', error = ? WHERE id = ?", [message, logId]);
    console.error(`[sms] ${message}`);
    return { ok: false, error: message };
  }

  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const { ref } = await send({ to, text, purpose });
      run("UPDATE sms_messages SET status = 'sent', provider_ref = ?, sent_at = ? WHERE id = ?", [
        ref, now(), logId,
      ]);
      return { ok: true, ref, logId };
    } catch (err) {
      lastError = err;
      const retriable = /fetch failed|ECONNRESET|ETIMEDOUT|network|\b5\d\d\b/i.test(err.message);
      if (!retriable || attempt === 2) break;
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  run("UPDATE sms_messages SET status = 'failed', error = ? WHERE id = ?", [
    String(lastError?.message ?? 'không rõ lỗi').slice(0, 500),
    logId,
  ]);
  console.error(`[sms] Gửi tới ${to} thất bại:`, lastError?.message);
  return { ok: false, error: lastError?.message, logId };
}
