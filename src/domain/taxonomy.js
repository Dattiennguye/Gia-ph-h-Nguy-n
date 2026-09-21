/**
 * Toàn bộ giá trị có thể chọn trong hồ sơ và nhu cầu.
 * Server và client dùng chung nguồn này (client lấy qua GET /api/meta/taxonomy),
 * nên thêm một lựa chọn ở đây là cả hai phía cùng có.
 */

const list = (...items) => items.map(([value, label]) => ({ value, label }));

export const taxonomy = {
  gender: list(
    ['male', 'Nam'],
    ['female', 'Nữ'],
    ['other', 'Khác']
  ),

  relationship_goal: list(
    ['love', 'Tìm người yêu'],
    ['partner', 'Tìm bạn đời'],
    ['marriage', 'Tìm người kết hôn'],
    ['friends', 'Tìm bạn / người cùng sở thích']
  ),

  marital_status: list(
    ['single', 'Độc thân'],
    ['divorced', 'Đã ly hôn'],
    ['widowed', 'Goá'],
    ['separated', 'Đang ly thân']
  ),

  has_children: list(
    ['none', 'Chưa có con'],
    ['yes_living_with', 'Có con, đang sống cùng'],
    ['yes_not_living_with', 'Có con, không sống cùng']
  ),

  education: list(
    ['high_school', 'Trung học'],
    ['vocational', 'Trung cấp / Cao đẳng nghề'],
    ['college', 'Cao đẳng'],
    ['bachelor', 'Đại học'],
    ['master', 'Thạc sĩ'],
    ['phd', 'Tiến sĩ']
  ),

  income_range: list(
    ['under_10m', 'Dưới 10 triệu/tháng'],
    ['10_20m', '10 – 20 triệu/tháng'],
    ['20_35m', '20 – 35 triệu/tháng'],
    ['35_50m', '35 – 50 triệu/tháng'],
    ['over_50m', 'Trên 50 triệu/tháng'],
    ['private', 'Không muốn tiết lộ']
  ),

  body_type: list(
    ['slim', 'Mảnh mai'],
    ['athletic', 'Thể thao'],
    ['average', 'Trung bình'],
    ['curvy', 'Đầy đặn'],
    ['plus', 'Ngoại cỡ']
  ),

  religion: list(
    ['none', 'Không tôn giáo'],
    ['buddhism', 'Phật giáo'],
    ['catholic', 'Công giáo'],
    ['protestant', 'Tin Lành'],
    ['caodai', 'Cao Đài'],
    ['hoahao', 'Hoà Hảo'],
    ['islam', 'Hồi giáo'],
    ['other', 'Khác'],
    ['private', 'Không muốn tiết lộ']
  ),

  smoking: list(
    ['never', 'Không hút thuốc'],
    ['occasionally', 'Thỉnh thoảng'],
    ['regularly', 'Thường xuyên']
  ),

  drinking: list(
    ['never', 'Không uống rượu bia'],
    ['occasionally', 'Thỉnh thoảng'],
    ['regularly', 'Thường xuyên']
  ),

  marriage_timeline: list(
    ['asap', 'Muốn kết hôn sớm'],
    ['1_3_years', 'Trong 1 – 3 năm nữa'],
    ['over_3_years', 'Sau 3 năm nữa'],
    ['undecided', 'Chưa xác định'],
    ['no_marriage', 'Không muốn kết hôn']
  ),

  children_wish: list(
    ['want', 'Muốn có con'],
    ['not_want', 'Không muốn có con'],
    ['undecided', 'Chưa quyết định'],
    ['open', 'Tuỳ vào người bạn đời']
  ),

  living_preference: list(
    ['near_family', 'Muốn sống gần gia đình'],
    ['independent', 'Muốn sống riêng, độc lập'],
    ['flexible', 'Linh hoạt, tuỳ hoàn cảnh']
  ),

  lifestyle: list(
    ['homebody', 'Thích ở nhà'],
    ['outgoing', 'Thích ra ngoài'],
    ['travel', 'Thích du lịch'],
    ['sports', 'Chơi thể thao'],
    ['fitness', 'Tập gym'],
    ['foodie', 'Thích ăn uống'],
    ['cooking', 'Thích nấu ăn'],
    ['nightlife', 'Thích tụ tập buổi tối'],
    ['nature', 'Thích thiên nhiên'],
    ['early_bird', 'Dậy sớm'],
    ['night_owl', 'Cú đêm'],
    ['pets', 'Yêu thú cưng'],
    ['saving', 'Sống tiết kiệm'],
    ['volunteering', 'Hoạt động thiện nguyện']
  ),

  interests: list(
    ['music', 'Âm nhạc'],
    ['movies', 'Phim ảnh'],
    ['reading', 'Đọc sách'],
    ['gaming', 'Game'],
    ['photography', 'Nhiếp ảnh'],
    ['coffee', 'Cà phê'],
    ['football', 'Bóng đá'],
    ['badminton', 'Cầu lông'],
    ['running', 'Chạy bộ'],
    ['yoga', 'Yoga'],
    ['dancing', 'Nhảy / khiêu vũ'],
    ['art', 'Hội hoạ'],
    ['tech', 'Công nghệ'],
    ['investing', 'Đầu tư'],
    ['motorbike', 'Phượt xe máy'],
    ['camping', 'Cắm trại'],
    ['karaoke', 'Karaoke'],
    ['gardening', 'Trồng cây']
  ),

  seriousness: [
    { value: 1, label: 'Chỉ muốn làm quen nhẹ nhàng' },
    { value: 2, label: 'Cởi mở, chưa vội' },
    { value: 3, label: 'Muốn tìm hiểu nghiêm túc' },
    { value: 4, label: 'Nghiêm túc, hướng tới lâu dài' },
    { value: 5, label: 'Rất nghiêm túc, sẵn sàng tiến tới hôn nhân' },
  ],

  report_category: list(
    ['fake_profile', 'Hồ sơ giả mạo'],
    ['harassment', 'Quấy rối'],
    ['scam', 'Lừa đảo / xin tiền'],
    ['inappropriate', 'Nội dung không phù hợp'],
    ['taken', 'Đã có người yêu / đã kết hôn'],
    ['spam', 'Spam'],
    ['underage', 'Nghi ngờ chưa đủ tuổi'],
    ['other', 'Khác']
  ),
};

/** Các trường hồ sơ có thể dùng làm tiêu chí lọc, kèm cách so sánh hợp lệ. */
export const ruleFields = {
  smoking:           { label: 'Hút thuốc',            type: 'enum',  source: 'smoking' },
  drinking:          { label: 'Uống rượu bia',        type: 'enum',  source: 'drinking' },
  marital_status:    { label: 'Tình trạng hôn nhân',  type: 'enum',  source: 'marital_status' },
  has_children:      { label: 'Con riêng',            type: 'enum',  source: 'has_children' },
  children_wish:     { label: 'Mong muốn có con',     type: 'enum',  source: 'children_wish' },
  marriage_timeline: { label: 'Dự định kết hôn',      type: 'enum',  source: 'marriage_timeline' },
  living_preference: { label: 'Nơi ở sau kết hôn',    type: 'enum',  source: 'living_preference' },
  education:         { label: 'Trình độ học vấn',     type: 'enum',  source: 'education' },
  religion:          { label: 'Tôn giáo',             type: 'enum',  source: 'religion' },
  income_range:      { label: 'Thu nhập',             type: 'enum',  source: 'income_range' },
  body_type:         { label: 'Dáng người',           type: 'enum',  source: 'body_type' },
  relationship_goal: { label: 'Mục đích tìm kiếm',    type: 'enum',  source: 'relationship_goal' },
  height_cm:         { label: 'Chiều cao (cm)',       type: 'number', min: 130, max: 220 },
  seriousness:       { label: 'Mức độ nghiêm túc',    type: 'number', min: 1, max: 5 },
  age:               { label: 'Tuổi',                 type: 'number', min: 18, max: 80 },
  lifestyle_tags:    { label: 'Lối sống',             type: 'tags',  source: 'lifestyle' },
  interest_tags:     { label: 'Sở thích',             type: 'tags',  source: 'interests' },
  verified:          { label: 'Đã xác minh danh tính', type: 'bool' },
};

/** Thứ tự thang bậc, dùng cho phép so sánh gte/lte trên trường enum. */
export const ordinalScales = {
  education: ['high_school', 'vocational', 'college', 'bachelor', 'master', 'phd'],
  income_range: ['under_10m', '10_20m', '20_35m', '35_50m', 'over_50m'],
  smoking: ['never', 'occasionally', 'regularly'],
  drinking: ['never', 'occasionally', 'regularly'],
};

const labelIndex = new Map();
for (const [group, items] of Object.entries(taxonomy)) {
  for (const item of items) labelIndex.set(`${group}:${item.value}`, item.label);
}

export function labelOf(group, value) {
  if (value == null) return null;
  return labelIndex.get(`${group}:${value}`) ?? String(value);
}

export function isValid(group, value) {
  return taxonomy[group]?.some((i) => i.value === value) ?? false;
}

export function valuesOf(group) {
  return (taxonomy[group] ?? []).map((i) => i.value);
}
