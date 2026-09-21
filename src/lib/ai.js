import { config } from '../config.js';

/**
 * Phần "viết bằng lời" của AI Matchmaker.
 *
 * Toàn bộ phân tích số liệu nằm ở src/domain/insights.js và chạy hoàn toàn
 * không cần API key. Module này chỉ nhận các con số ĐÃ tính sẵn rồi nhờ Claude
 * diễn đạt lại thành lời khuyên tiếng Việt. Không có key thì bỏ qua, app vẫn
 * hoạt động đầy đủ.
 */

let clientPromise = null;

async function getClient() {
  if (!config.ai.enabled) return null;
  if (!clientPromise) {
    clientPromise = (async () => {
      try {
        const { default: Anthropic } = await import('@anthropic-ai/sdk');
        return new Anthropic({ apiKey: config.ai.apiKey });
      } catch (err) {
        console.warn(
          '[ai] Không nạp được @anthropic-ai/sdk — bỏ qua phần nhận xét bằng lời:',
          err.message
        );
        return null;
      }
    })();
  }
  return clientPromise;
}

const SYSTEM = `Bạn là trợ lý mai mối của Vigo Match, một ứng dụng hẹn hò nghiêm túc tại Việt Nam.

Bạn nhận vào các CON SỐ ĐÃ ĐƯỢC TÍNH SẴN từ dữ liệu thật của hệ thống. Nhiệm vụ của bạn
là diễn đạt chúng thành lời khuyên ngắn gọn, ấm áp, bằng tiếng Việt.

Quy tắc bắt buộc:
- Chỉ dùng những con số được cung cấp. Tuyệt đối không bịa thêm số liệu.
- Không phán xét tiêu chí của người dùng. Họ có quyền giữ nguyên mọi tiêu chí.
- Nêu rõ đánh đổi, rồi để người dùng tự quyết định.
- Tối đa 3 câu. Giọng thân thiện, xưng "bạn", không sáo rỗng.
- Không hứa hẹn chuyện tình cảm, không nói chắc chắn sẽ tìm được ai.`;

/**
 * @param {object} analysis kết quả từ analyzePreferences/analyzeBehaviour
 * @returns {Promise<string|null>} đoạn nhận xét, hoặc null nếu không bật AI
 */
export async function narrate(analysis) {
  const client = await getClient();
  if (!client) return null;

  const facts = {
    tổng_hồ_sơ_đang_hoạt_động: analysis.poolSize,
    số_hồ_sơ_lọt_qua_bộ_lọc: analysis.matching,
    bán_kính_hiện_tại_km: analysis.radiusKm,
    khoảng_tuổi: analysis.ageRange,
    số_tiêu_chí_bắt_buộc: analysis.mustRuleCount,
    tiêu_chí_loại_nhiều_nhất: (analysis.ruleImpact ?? []).slice(0, 3).map((r) => ({
      tiêu_chí: r.text,
      loại_bao_nhiêu_hồ_sơ: r.excluded,
      phần_trăm: r.excludedPct,
    })),
    nhận_định_hệ_thống_đã_tính: (analysis.insights ?? []).map((i) => i.title),
  };

  try {
    const response = await client.messages.create({
      model: config.ai.model,
      max_tokens: 1000,
      system: SYSTEM,
      output_config: { effort: 'low' },
      messages: [
        {
          role: 'user',
          content: `Đây là số liệu thật về bộ tiêu chí tìm kiếm của một người dùng:

${JSON.stringify(facts, null, 2)}

Hãy viết cho họ một đoạn nhận xét ngắn (tối đa 3 câu) về việc bộ tiêu chí hiện tại đang ảnh hưởng thế nào tới kết quả tìm kiếm, và điều họ có thể cân nhắc.`,
        },
      ],
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    return text || null;
  } catch (err) {
    console.warn('[ai] Gọi Claude thất bại, bỏ qua nhận xét:', err.message);
    return null;
  }
}

export function aiStatus() {
  return {
    enabled: config.ai.enabled,
    model: config.ai.enabled ? config.ai.model : null,
    note: config.ai.enabled
      ? 'AI Matchmaker có cả phân tích số liệu và nhận xét bằng lời.'
      : 'AI Matchmaker đang chạy bằng phân tích số liệu trên dữ liệu thật. Thêm ANTHROPIC_API_KEY để bật phần nhận xét bằng lời.',
  };
}
