/**
 * PHÁT HIỆN HÀNH VI ĐÁNG NGỜ
 *
 * Không có "AI hộp đen" ở đây: mỗi tín hiệu là một luật đọc được, có điểm rủi
 * ro riêng, và luôn ghi lại lý do để người kiểm duyệt đối chiếu.
 *
 * Kết quả:
 *   clean   → cho qua
 *   warned  → vẫn gửi, nhưng người nhận thấy cảnh báo và hệ thống mở hồ sơ theo dõi
 *   blocked → chặn gửi, mở ca kiểm duyệt mức cao
 */

const SIGNALS = [
  {
    key: 'money_request',
    label: 'Đề cập chuyển tiền / vay mượn',
    severity: 5,
    test: (t) =>
      /(chuyển|chuyen|gửi|gui|cho\s+m[ìi]nh\s+vay|vay)\s*(tiền|tien|khoản|tạm|gấp|\d)/i.test(t) ||
      /(số\s*tài\s*khoản|so\s*tai\s*khoan|stk|số\s*tk)\s*[:\s]*\d{6,}/i.test(t) ||
      /\b\d{9,19}\b\s*(vietcombank|vcb|techcombank|tcb|mbbank|mb\s*bank|bidv|agribank|vietinbank|acb|momo|vnpay)/i.test(t) ||
      /(momo|vi[eê]tcombank|bidv|techcombank)\s*[:\-]?\s*\d{8,}/i.test(t),
  },
  {
    key: 'investment_lure',
    label: 'Dụ đầu tư / việc nhẹ lương cao',
    severity: 5,
    test: (t) =>
      /(đầu\s*tư|dau\s*tu|sàn|san\s+giao\s*dịch|forex|crypto|tiền\s*ảo|coin|lãi\s*suất|loi\s*nhuan|lợi\s*nhuận)\s*.{0,30}(cao|x\d|\d{2,}%|cam\s*kết|nhanh|gấp\s*\d)/i.test(t) ||
      /(việc\s*nhẹ|viec\s*nhe)\s*(lương|luong)\s*cao/i.test(t) ||
      /(kiếm|kiem)\s*\d+\s*(triệu|trieu|tr)\s*(\/|một|mot|mỗi|moi)?\s*(ngày|ngay|tuần|tuan)/i.test(t),
  },
  {
    key: 'credential_request',
    label: 'Hỏi thông tin tài khoản / mã OTP',
    severity: 8,
    test: (t) =>
      /(mã|ma)\s*otp|mật\s*khẩu|mat\s*khau|password|mã\s*xác\s*(minh|thực)|cvv|số\s*thẻ|so\s*the/i.test(t),
  },
  {
    key: 'suspicious_link',
    label: 'Gửi liên kết lạ',
    severity: 3,
    test: (t) =>
      /(https?:\/\/|www\.)\S+/i.test(t) &&
      !/(facebook|instagram|zalo|tiktok|youtube|spotify|google)\.com/i.test(t),
  },
  {
    key: 'move_offplatform',
    label: 'Rủ chuyển sang nền tảng khác quá sớm',
    severity: 2,
    test: (t) =>
      /(zalo|telegram|whatsapp|viber|wechat|line)\b/i.test(t) &&
      /(kết\s*bạn|ket\s*ban|nhắn|nhan|add|sang|qua|chuyển|chuyen|cho\s*mình\s*xin|số|so)/i.test(t),
  },
  {
    key: 'contact_dump',
    label: 'Gửi số điện thoại ngay từ đầu',
    severity: 1,
    test: (t) => /(^|\D)(0|\+84)\d{8,10}(\D|$)/.test(t),
  },
  {
    key: 'sexual_content',
    label: 'Nội dung nhạy cảm',
    severity: 3,
    test: (t) => /(ảnh\s*nóng|anh\s*nong|sex|gạ\s*tình|ga\s*tinh|qua\s*đêm|show\s*hàng|\bnude\b)/i.test(t),
  },
  {
    key: 'urgency_pressure',
    label: 'Tạo áp lực gấp gáp',
    severity: 2,
    test: (t) =>
      /(gấp|gap|ngay\s*bây\s*giờ|trong\s*hôm\s*nay|nhanh\s*lên)/i.test(t) &&
      /(tiền|tien|chuyển|chuyen|giúp|giup|cứu|cuu)/i.test(t),
  },
];

/** Quét một tin nhắn. Trả về trạng thái, danh sách tín hiệu và điểm rủi ro. */
export function scanMessage(body) {
  const text = String(body ?? '');
  const flags = [];
  let risk = 0;

  for (const sig of SIGNALS) {
    if (sig.test(text)) {
      flags.push({ key: sig.key, label: sig.label, severity: sig.severity });
      risk += sig.severity;
    }
  }

  // Hai tín hiệu tài chính cùng lúc thì gần như chắc chắn là lừa đảo.
  const financial = flags.filter((f) =>
    ['money_request', 'investment_lure', 'credential_request'].includes(f.key)
  );
  if (financial.length >= 2) risk += 4;

  const state = risk >= 8 ? 'blocked' : risk >= 3 ? 'warned' : 'clean';
  return { state, risk, flags };
}

/**
 * Phát hiện spam hàng loạt: cùng một nội dung gửi cho nhiều người trong thời
 * gian ngắn. `recent` là danh sách tin đã gửi gần đây của chính người đó.
 */
export function detectBulkSpam(body, recent) {
  const norm = (s) =>
    String(s ?? '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[.,!?;:()"'-]/g, '')
      .trim();

  const target = norm(body);
  if (target.length < 12) return null;

  const partners = new Set();
  for (const m of recent) {
    if (norm(m.body) === target) partners.add(m.conversation_id);
  }
  if (partners.size >= 3) {
    return {
      key: 'bulk_identical',
      label: `Gửi cùng một nội dung cho ${partners.size + 1} cuộc trò chuyện`,
      severity: 4,
      conversations: partners.size + 1,
    };
  }
  return null;
}

/** Xếp mức rủi ro của một ca kiểm duyệt từ tổng điểm tín hiệu. */
export function riskLevel(score) {
  if (score >= 8) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

/** Cảnh báo hiển thị cho người nhận khi tin nhắn bị gắn cờ. */
export function warningFor(flags) {
  const keys = new Set(flags.map((f) => f.key));
  if (keys.has('money_request') || keys.has('investment_lure') || keys.has('urgency_pressure')) {
    return 'Hãy cẩn thận nếu một người bạn mới quen đề nghị chuyển tiền, đầu tư hoặc hỏi thông tin tài chính. Vigo Match không bao giờ yêu cầu bạn làm việc đó.';
  }
  if (keys.has('credential_request')) {
    return 'Không bao giờ chia sẻ mã OTP, mật khẩu hay số thẻ ngân hàng với bất kỳ ai, kể cả người tự xưng là nhân viên hỗ trợ.';
  }
  if (keys.has('suspicious_link')) {
    return 'Tin nhắn này chứa một liên kết lạ. Hãy cân nhắc trước khi mở.';
  }
  if (keys.has('move_offplatform')) {
    return 'Người này muốn chuyển sang nền tảng khác khá sớm. Hãy trò chuyện thêm ở đây cho tới khi bạn thấy an tâm.';
  }
  return 'Hãy thận trọng với nội dung trong tin nhắn này.';
}

export const SAFETY_TIPS = [
  'Không chuyển tiền cho người bạn chưa từng gặp mặt.',
  'Không chia sẻ mã OTP, mật khẩu hay thông tin thẻ ngân hàng.',
  'Hẹn gặp lần đầu ở nơi công cộng, báo cho người thân biết bạn đi đâu.',
  'Cẩn trọng với lời mời đầu tư, "việc nhẹ lương cao" hay link lạ.',
  'Nếu thấy dấu hiệu bất thường, hãy chặn và báo cáo — chúng tôi xử lý mọi báo cáo.',
];
