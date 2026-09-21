/** Bán kính Trái Đất trung bình (km). */
const R = 6371;

const toRad = (deg) => (deg * Math.PI) / 180;

/** Khoảng cách vòng lớn giữa hai toạ độ, tính bằng km. */
export function haversineKm(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => typeof v !== 'number' || Number.isNaN(v))) {
    return null;
  }
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Hộp bao quanh một điểm, dùng để lọc thô bằng SQL trước khi tính haversine
 * chính xác. Nhanh hơn nhiều so với quét toàn bảng.
 */
export function boundingBox(lat, lng, radiusKm) {
  const dLat = radiusKm / 111.32;
  const cos = Math.cos(toRad(lat));
  const dLng = radiusKm / (111.32 * (Math.abs(cos) < 1e-6 ? 1e-6 : cos));
  return {
    minLat: lat - dLat,
    maxLat: lat + dLat,
    minLng: lng - Math.abs(dLng),
    maxLng: lng + Math.abs(dLng),
  };
}

/**
 * Khoảng cách hiển thị cho người dùng — luôn làm tròn để không thể suy ngược
 * ra vị trí chính xác của đối phương.
 */
export function fuzzyDistanceLabel(km) {
  if (km == null) return 'Không rõ khoảng cách';
  if (km < 1) return 'Dưới 1 km';
  if (km < 10) return `Khoảng ${km.toFixed(1)} km`;
  if (km < 100) return `Khoảng ${Math.round(km)} km`;
  return `Hơn ${Math.floor(km / 10) * 10} km`;
}

/** Làm tròn khoảng cách trước khi trả ra API. */
export function fuzzyDistanceKm(km) {
  if (km == null) return null;
  if (km < 1) return 0.5;
  if (km < 10) return Math.round(km * 10) / 10;
  return Math.round(km);
}

/**
 * Xê dịch toạ độ ngẫu nhiên nhưng ổn định (cùng một người luôn lệch như nhau)
 * trong bán kính ~700m. Dùng cho bản đồ: chấm hiển thị gần đúng khu vực, không
 * phải vị trí thật.
 */
export function jitterPoint(lat, lng, seed) {
  let h = 2166136261;
  for (const ch of String(seed)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  const angle = ((h >>> 0) % 3600) / 3600 * 2 * Math.PI;
  const radiusKm = 0.2 + (((h >>> 8) % 500) / 1000);
  const dLat = (radiusKm / 111.32) * Math.cos(angle);
  const dLng = (radiusKm / (111.32 * Math.cos(toRad(lat)) || 1)) * Math.sin(angle);
  return { lat: lat + dLat, lng: lng + dLng };
}
