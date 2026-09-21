import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { scanMessage, detectBulkSpam, riskLevel, warningFor } from '../src/domain/safety.js';

describe('Phát hiện hành vi đáng ngờ', () => {
  test('tin nhắn bình thường không bị gắn cờ', () => {
    for (const t of [
      'Chào bạn, cuối tuần này rảnh không mình đi cà phê nhé',
      'Mình làm kỹ sư phần mềm, còn bạn làm nghề gì?',
      'Hôm qua mình đi Đà Lạt, cảnh đẹp lắm',
      'Bạn thích ăn món gì nhất?',
    ]) {
      assert.equal(scanMessage(t).state, 'clean', `câu này không nên bị gắn cờ: ${t}`);
    }
  });

  test('xin tiền bị chặn', () => {
    const r = scanMessage('Em ơi anh kẹt tiền gấp, chuyển giúp anh 5 triệu vào STK 0123456789 Vietcombank nhé');
    assert.equal(r.state, 'blocked');
    assert.ok(r.flags.some((f) => f.key === 'money_request'));
  });

  test('hỏi mã OTP bị chặn', () => {
    const r = scanMessage('Cho anh xin mã OTP vừa gửi về máy em nhé');
    assert.equal(r.state, 'blocked');
    assert.ok(r.flags.some((f) => f.key === 'credential_request'));
  });

  test('dụ đầu tư bị cảnh báo', () => {
    const r = scanMessage('Bên anh có sàn đầu tư lãi suất cao cam kết x3 trong 1 tuần, em tham gia không');
    assert.ok(['warned', 'blocked'].includes(r.state));
    assert.ok(r.flags.some((f) => f.key === 'investment_lure'));
  });

  test('rủ sang nền tảng khác bị cảnh báo nhưng vẫn gửi được', () => {
    const r = scanMessage('Kết bạn zalo với mình nhé 0987654321');
    assert.equal(r.state, 'warned');
    assert.match(warningFor(r.flags), /nền tảng khác/);
  });

  test('phát hiện gửi cùng nội dung cho nhiều người', () => {
    const recent = [1, 2, 3].map((i) => ({ conversation_id: i, body: 'Chào em, anh thấy em xinh quá!' }));
    const bulk = detectBulkSpam('chào em anh thấy em xinh quá', recent);
    assert.ok(bulk);
    assert.equal(bulk.conversations, 4);
  });

  test('tin ngắn không bị coi là spam hàng loạt', () => {
    const recent = [1, 2, 3].map((i) => ({ conversation_id: i, body: 'hi' }));
    assert.equal(detectBulkSpam('hi', recent), null);
  });

  test('phân mức rủi ro', () => {
    assert.equal(riskLevel(1), 'low');
    assert.equal(riskLevel(4), 'medium');
    assert.equal(riskLevel(9), 'high');
  });
});
