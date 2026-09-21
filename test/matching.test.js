import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { scorePair, explain, hardFilter, evaluateRule, ageFrom, matchTier, WEIGHTS } from '../src/domain/matching.js';

const base = {
  profile: {
    birth_date: '2000-05-10', gender: 'male', lat: 20.845, lng: 105.872,
    relationship_goal: 'marriage', marriage_timeline: 'asap', children_wish: 'want',
    living_preference: 'near_family', smoking: 'never', drinking: 'occasionally',
    lifestyle_tags: ['homebody', 'travel', 'saving'],
    interest_tags: ['music', 'football', 'coffee'], seriousness: 5,
  },
  preference: {
    interested_in: ['female'], age_min: 20, age_max: 27,
    max_distance_km: 20, relationship_goals: ['marriage', 'partner'],
  },
  rules: [],
};

const her = {
  profile: {
    birth_date: '2001-08-02', gender: 'female', lat: 20.86, lng: 105.77,
    relationship_goal: 'marriage', marriage_timeline: 'asap', children_wish: 'want',
    living_preference: 'near_family', smoking: 'never', drinking: 'never',
    lifestyle_tags: ['homebody', 'travel', 'cooking'],
    interest_tags: ['music', 'reading', 'coffee'], seriousness: 5,
  },
  preference: {
    interested_in: ['male'], age_min: 24, age_max: 32,
    max_distance_km: 25, relationship_goals: ['marriage'],
  },
  rules: [],
};

const clone = (o) => structuredClone(o);

describe('Thuật toán ghép đôi', () => {
  test('tổng trọng số bằng 100', () => {
    assert.equal(Object.values(WEIGHTS).reduce((a, b) => a + b, 0), 100);
  });

  test('hai người cùng quan điểm cho điểm rất cao', () => {
    const r = scorePair(base, her);
    assert.ok(r.score >= 80, `mong đợi ≥80, nhận được ${r.score}`);
    assert.ok(['excellent', 'high'].includes(matchTier(r.score).key));
  });

  test('quan điểm trái ngược kéo điểm xuống rõ rệt', () => {
    const khac = clone(her);
    khac.profile.marriage_timeline = 'no_marriage';
    khac.profile.children_wish = 'not_want';
    khac.profile.living_preference = 'independent';
    khac.profile.interest_tags = ['gaming'];
    khac.profile.lifestyle_tags = ['nightlife'];
    const r = scorePair(base, khac);
    assert.ok(r.score < 55, `mong đợi <55, nhận được ${r.score}`);
  });

  test('giải thích nêu đúng điểm chung và điểm cần cân nhắc', () => {
    const e = explain(scorePair(base, her));
    const texts = e.positives.map((p) => p.text).join(' | ');
    assert.match(texts, /Cùng tìm người kết hôn/);
    assert.match(texts, /Cùng muốn có con/);

    const khac = clone(her);
    khac.profile.children_wish = 'not_want';
    const e2 = explain(scorePair(base, khac));
    assert.ok(e2.considerations.some((c) => /không muốn có con/.test(c.text)));
  });

  test('tiêu chí BẮT BUỘC loại hẳn ứng viên', () => {
    const viewer = clone(base);
    viewer.rules = [{ id: 1, kind: 'must', field: 'smoking', operator: 'eq', value: 'never', weight: 5 }];
    const hut = clone(her);
    hut.profile.smoking = 'regularly';

    assert.equal(hardFilter(viewer, her, 10).length, 0, 'người không hút thuốc phải lọt qua');
    const blocked = hardFilter(viewer, hut, 10);
    assert.equal(blocked.length, 1);
    assert.match(blocked[0].label, /Hút thuốc/);
  });

  test('tiêu chí ƯU TIÊN không loại ai, chỉ giảm điểm', () => {
    const viewer = clone(base);
    viewer.rules = [{ id: 2, kind: 'prefer', field: 'education', operator: 'gte', value: 'master', weight: 4 }];
    const thap = clone(her);
    thap.profile.education = 'high_school';
    const cao = clone(her);
    cao.profile.education = 'phd';

    assert.equal(hardFilter(viewer, thap, 10).length, 0, 'tiêu chí ưu tiên không được loại ai');
    assert.ok(scorePair(viewer, cao).score > scorePair(viewer, thap).score);
  });

  test('bộ lọc cứng chạy HAI CHIỀU — không hiện người đã loại mình ra', () => {
    const nguoiKhac = clone(her);
    nguoiKhac.preference.age_min = 40; // cô ấy chỉ tìm người từ 40 tuổi
    const blocked = hardFilter(base, nguoiKhac, 10);
    assert.ok(blocked.some((b) => b.dir === 'candidate' && b.reason === 'age'));
  });

  test('vượt bán kính thì bị loại', () => {
    assert.equal(hardFilter(base, her, 10).length, 0);
    assert.ok(hardFilter(base, her, 100).some((b) => b.reason === 'distance'));
  });

  test('hồ sơ thiếu dữ liệu vẫn ghép được, chỉ kém chắc chắn hơn', () => {
    const thieu = { profile: { gender: 'female', birth_date: '2000-01-01', lat: 20.85, lng: 105.86 } };
    const r = scorePair(base, thieu);
    assert.ok(r.score > 0);
    assert.ok(r.confidence < 70, `độ tin cậy phải thấp, nhận được ${r.confidence}`);
  });

  test('phép so sánh trong luật hoạt động đúng', () => {
    const p = { education: 'bachelor', height_cm: 170, interest_tags: ['music', 'coffee'], birth_date: '2000-01-01' };
    assert.equal(evaluateRule({ field: 'education', operator: 'gte', value: 'college' }, p), true);
    assert.equal(evaluateRule({ field: 'education', operator: 'gte', value: 'master' }, p), false);
    assert.equal(evaluateRule({ field: 'height_cm', operator: 'between', value: [165, 180] }, p), true);
    assert.equal(evaluateRule({ field: 'interest_tags', operator: 'contains_any', value: ['coffee'] }, p), true);
    assert.equal(evaluateRule({ field: 'interest_tags', operator: 'contains_all', value: ['coffee', 'gaming'] }, p), false);
    assert.equal(evaluateRule({ field: 'religion', operator: 'eq', value: 'none' }, p), null, 'thiếu dữ liệu → null');
  });

  test('tính tuổi chính xác quanh ngày sinh nhật', () => {
    const at = new Date('2026-05-09T00:00:00Z').getTime();
    assert.equal(ageFrom('2000-05-10', at), 25);
    assert.equal(ageFrom('2000-05-10', at + 86400000), 26);
  });
});
