import { labelOf } from './taxonomy.js';

/**
 * Câu mở lời được sinh từ ĐIỂM CHUNG THẬT của hai người, không phải câu chúc
 * chung chung. Nếu không tìm được điểm chung nào, mới rơi về câu mặc định.
 */

const BY_INTEREST = {
  music: 'Dạo này bạn hay nghe gì? Mình đang tìm thêm nhạc mới.',
  movies: 'Bộ phim gần nhất khiến bạn nhớ mãi là phim nào?',
  reading: 'Cuốn sách gần đây bạn đọc xong là cuốn nào?',
  coffee: 'Bạn thuộc kiểu cà phê sáng sớm hay cà phê chiều muộn?',
  football: 'Bạn theo đội nào vậy? Mình hỏi để biết có nên tranh luận không thôi.',
  running: 'Bạn hay chạy ở đâu? Mình đang tìm cung đường mới.',
  photography: 'Bạn thích chụp người hay chụp cảnh hơn?',
  cooking: 'Món tủ của bạn là món gì?',
  gaming: 'Dạo này bạn cày game gì?',
  camping: 'Chuyến cắm trại đáng nhớ nhất của bạn ở đâu?',
  yoga: 'Bạn tập yoga lâu chưa? Mình đang muốn bắt đầu.',
  tech: 'Có thứ công nghệ nào gần đây làm bạn thấy thú vị không?',
  motorbike: 'Cung đường phượt bạn thích nhất là cung nào?',
  investing: 'Bạn theo trường phái đầu tư dài hạn hay lướt sóng?',
  art: 'Bạn vẽ hay chủ yếu đi xem triển lãm?',
  gardening: 'Ban công nhà bạn đang trồng gì thế?',
  dancing: 'Bạn nhảy được bao lâu rồi?',
  badminton: 'Cuối tuần bạn hay đánh cầu ở đâu?',
  karaoke: 'Bài tủ karaoke của bạn là bài nào?',
};

const BY_LIFESTYLE = {
  travel: 'Chuyến đi gần nhất của bạn là đi đâu?',
  homebody: 'Cuối tuần lý tưởng ở nhà của bạn sẽ như thế nào?',
  foodie: 'Quán ăn ruột của bạn ở khu này là quán nào?',
  sports: 'Bạn chơi môn gì đều đặn nhất?',
  fitness: 'Bạn tập buổi sáng hay buổi tối?',
  pets: 'Bạn nuôi bé nào ở nhà không?',
  nature: 'Bạn thích núi hay biển hơn?',
  early_bird: 'Bạn dậy sớm thật hay chỉ là đang cố gắng thôi?',
  night_owl: 'Đêm khuya bạn hay làm gì?',
  volunteering: 'Bạn đang tham gia hoạt động thiện nguyện nào không?',
  nightlife: 'Tối cuối tuần bạn hay đi đâu?',
  cooking: 'Bạn nấu ăn thường xuyên chứ?',
  saving: 'Bạn có mẹo tiết kiệm nào hay không?',
  outgoing: 'Cuối tuần này bạn có kế hoạch gì chưa?',
};

const FALLBACK = [
  'Cuối tuần lý tưởng của bạn sẽ như thế nào?',
  'Điều gì khiến bạn cười nhiều nhất trong tuần này?',
  'Nếu có một ngày rảnh hoàn toàn, bạn sẽ làm gì?',
  'Bạn đang mong chờ điều gì nhất trong thời gian tới?',
];

/**
 * @param {object} a hồ sơ người A
 * @param {object} b hồ sơ người B
 * @param {object[]} positives danh sách điểm phù hợp từ explain()
 * @returns {{question:string, shared:string[]}}
 */
export function buildIcebreaker(a, b, positives = []) {
  const shared = [];

  const interests = (a.interest_tags ?? []).filter((t) => (b.interest_tags ?? []).includes(t));
  const lifestyle = (a.lifestyle_tags ?? []).filter((t) => (b.lifestyle_tags ?? []).includes(t));

  for (const t of interests) shared.push(labelOf('interests', t));
  for (const t of lifestyle) shared.push(labelOf('lifestyle', t));

  if (a.relationship_goal && a.relationship_goal === b.relationship_goal) {
    shared.unshift(labelOf('relationship_goal', a.relationship_goal));
  }

  // Ưu tiên một sở thích chung cụ thể — câu hỏi sẽ tự nhiên nhất.
  for (const t of interests) {
    if (BY_INTEREST[t]) return { question: BY_INTEREST[t], shared, basedOn: t };
  }
  for (const t of lifestyle) {
    if (BY_LIFESTYLE[t]) return { question: BY_LIFESTYLE[t], shared, basedOn: t };
  }

  const seed = `${a.user_id ?? 0}-${b.user_id ?? 0}`;
  const idx = [...seed].reduce((s, c) => s + c.charCodeAt(0), 0) % FALLBACK.length;
  return { question: FALLBACK[idx], shared, basedOn: null };
}

/** Các dòng "hai bạn đều..." hiển thị ngay khi vừa match. */
export function matchHighlights(a, b, positives = []) {
  const lines = positives.map((p) => p.text);
  if (lines.length) return lines.slice(0, 4);

  const out = [];
  if (a.relationship_goal === b.relationship_goal && a.relationship_goal) {
    out.push(`Cùng ${labelOf('relationship_goal', a.relationship_goal).toLowerCase()}`);
  }
  const shared = (a.interest_tags ?? []).filter((t) => (b.interest_tags ?? []).includes(t));
  if (shared.length) {
    out.push(`Cùng thích ${shared.slice(0, 2).map((t) => labelOf('interests', t).toLowerCase()).join(', ')}`);
  }
  return out;
}
