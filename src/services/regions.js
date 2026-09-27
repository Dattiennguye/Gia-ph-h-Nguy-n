import { all, get, insert, run, transaction } from '../db/index.js';
import { vietnam } from '../../data/regions.vn.js';

/** Tạo mã ổn định cho một đơn vị hành chính từ đường dẫn tên của nó. */
function slug(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Nạp cây địa giới vào DB. Chạy lại nhiều lần vẫn an toàn (idempotent). */
export const seedRegions = transaction(() => {
  let count = 0;

  const walk = (node, level, parentId, parentCode) => {
    const code = parentCode ? `${parentCode}.${slug(node.name)}` : slug(node.name);
    const fullName = parentCode
      ? `${node.name}, ${get('SELECT full_name FROM regions WHERE id = ?', [parentId]).full_name}`
      : node.name;

    const existing = get('SELECT id FROM regions WHERE code = ?', [code]);
    let id;
    if (existing) {
      id = existing.id;
      run('UPDATE regions SET name = ?, full_name = ?, lat = ?, lng = ? WHERE id = ?', [
        node.name,
        fullName,
        node.lat,
        node.lng,
        id,
      ]);
    } else {
      id = insert(
        `INSERT INTO regions (parent_id, level, code, name, full_name, lat, lng, signup_open)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        [parentId, level, code, node.name, fullName, node.lat, node.lng]
      );
      count += 1;
    }

    const childLevel =
      level === 'country' ? 'province' : level === 'province' ? 'district' : 'ward';
    for (const child of node.children ?? []) walk(child, childLevel, id, code);
  };

  walk(vietnam, 'country', null, null);
  labelCache.clear();
  return count;
});

export function listChildren(parentId = null) {
  return parentId == null
    ? all('SELECT * FROM regions WHERE parent_id IS NULL ORDER BY name')
    : all('SELECT * FROM regions WHERE parent_id = ? ORDER BY name', [parentId]);
}

export function getRegion(id) {
  return get('SELECT * FROM regions WHERE id = ?', [id]);
}

/** Đường dẫn từ gốc tới một khu vực: [Việt Nam, Hà Nội, Thường Tín, Thượng Phúc]. */
export function regionPath(id) {
  const path = [];
  let current = getRegion(id);
  let guard = 0;
  while (current && guard++ < 10) {
    path.unshift(current);
    current = current.parent_id ? getRegion(current.parent_id) : null;
  }
  return path;
}

/**
 * Khu vực hiển thị công khai cho người khác: luôn lùi lên cấp quận/huyện nếu
 * người dùng chọn tới cấp xã/phường — đủ để biết "cùng khu vực", không đủ để
 * tìm ra nhà.
 *
 * Kết quả được nhớ lại. Địa giới hành chính không đổi trong lúc chạy, mà hàm
 * này bị gọi cho từng người trong danh sách — trước khi nhớ, một lần mở bản đồ
 * tốn hàng trăm truy vấn chỉ để tra đi tra lại cùng mấy cái tên.
 */
const labelCache = new Map();

export function publicRegionLabel(id) {
  if (id == null) return null;
  if (labelCache.has(id)) return labelCache.get(id);

  const path = regionPath(id);
  let label = null;
  if (path.length) {
    const district = path.find((r) => r.level === 'district');
    const province = path.find((r) => r.level === 'province');
    label = district && province
      ? `${district.name}, ${province.name}`
      : province
        ? province.name
        : path[path.length - 1].name;
  }
  labelCache.set(id, label);
  return label;
}

/** Xoá bộ nhớ đệm — gọi sau khi nạp lại cây địa giới. */
export function clearRegionCache() {
  labelCache.clear();
}

/** Tìm kiếm theo tên, không phân biệt dấu. */
export function searchRegions(query, limit = 20) {
  const q = `%${slug(query).replace(/-/g, '%')}%`;
  return all(
    `SELECT * FROM regions
     WHERE level IN ('province','district','ward') AND code LIKE ?
     ORDER BY CASE level WHEN 'province' THEN 1 WHEN 'district' THEN 2 ELSE 3 END, name
     LIMIT ?`,
    [q, limit]
  );
}

/** Danh sách khu vực đang mở đăng ký — kiểm soát mật độ người dùng. */
export function openProvinces() {
  return all(
    "SELECT * FROM regions WHERE level = 'province' AND signup_open = 1 ORDER BY name"
  );
}

export function setSignupOpen(regionId, open) {
  run('UPDATE regions SET signup_open = ? WHERE id = ?', [open ? 1 : 0, regionId]);
  // Áp dụng cho toàn bộ cấp dưới.
  const children = all('SELECT id FROM regions WHERE parent_id = ?', [regionId]);
  for (const c of children) setSignupOpen(c.id, open);
}

/** Khu vực có đang nhận đăng ký không (xét cả cây cha). */
export function isSignupOpen(regionId) {
  return regionPath(regionId).every((r) => r.signup_open === 1);
}
