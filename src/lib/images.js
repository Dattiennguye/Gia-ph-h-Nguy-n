import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { badRequest } from './http.js';

/**
 * LƯU ẢNH
 *
 * Client gửi lên một data URI (tiện cho web, không cần thư viện multipart).
 * Máy chủ giải mã ngay và ghi ra tệp, chỉ lưu ĐƯỜNG DẪN vào cơ sở dữ liệu.
 *
 * Vì sao không nhét thẳng data URI vào DB: mỗi ảnh vài trăm KB nhân với số
 * người dùng sẽ làm phình bảng, khiến mọi truy vấn hồ sơ chậm đi, và sao lưu
 * nặng lên vô ích. Ảnh là tệp — hãy để nó là tệp.
 *
 * Khi chuyển sang lưu trữ đối tượng (S3/R2), chỉ cần thay thân hàm `storeImage`.
 */

const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export const uploadDir = path.resolve(config.uploadDir);

function ensureDir() {
  fs.mkdirSync(uploadDir, { recursive: true });
}

/**
 * Nhận data URI đã qua kiểm tra, ghi ra tệp, trả về đường dẫn công khai.
 * Nếu đầu vào đã là đường dẫn nội bộ thì giữ nguyên.
 */
export function storeImage(dataUri, { prefix = 'img' } = {}) {
  if (dataUri.startsWith('/uploads/')) return dataUri;

  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUri);
  if (!m) throw badRequest('Định dạng ảnh không hợp lệ');

  const ext = MIME_EXT[m[1].toLowerCase()];
  if (!ext) throw badRequest('Định dạng ảnh không được hỗ trợ');

  const buffer = Buffer.from(m[2], 'base64');
  if (!looksLikeImage(buffer, ext)) {
    throw badRequest('Tệp này không phải ảnh hợp lệ');
  }

  ensureDir();
  const name = `${prefix}-${crypto.randomBytes(12).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(uploadDir, name), buffer);
  return `/uploads/${name}`;
}

/**
 * Kiểm tra vài byte đầu tệp. Phần mở rộng do client khai không đáng tin — một
 * tệp HTML đặt tên .png vẫn có thể bị trình duyệt diễn giải sai ở nơi khác.
 */
function looksLikeImage(buf, ext) {
  if (buf.length < 12) return false;
  const hex = buf.subarray(0, 12).toString('hex');
  switch (ext) {
    case 'png':
      return hex.startsWith('89504e470d0a1a0a');
    case 'jpg':
      return hex.startsWith('ffd8ff');
    case 'gif':
      return hex.startsWith('474946383761') || hex.startsWith('474946383961');
    case 'webp':
      return hex.startsWith('52494646') && buf.subarray(8, 12).toString('ascii') === 'WEBP';
    default:
      return false;
  }
}

/** Xoá tệp ảnh khi người dùng gỡ ảnh khỏi hồ sơ. */
export function deleteImage(publicPath) {
  if (!publicPath?.startsWith('/uploads/')) return;
  const name = path.basename(publicPath);
  try {
    fs.unlinkSync(path.join(uploadDir, name));
  } catch {
    /* tệp đã không còn — không sao */
  }
}

/* ------------------------------------------------------------ ảnh mặc định */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Chữ cái 5×7, đủ cho ảnh đại diện mặc định. */
const FONT = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11], B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e], D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f], F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f], H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e], J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11], L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11], N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e], P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d], R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e], T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e], V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0a], X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04], Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
};

const hslToRgb = (h, s, l) => {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
};

/**
 * Ảnh đại diện mặc định: nền chuyển màu cộng chữ cái đầu của tên.
 *
 * Sinh ra PNG thật (không phải SVG) vì hệ thống từ chối SVG do người dùng gửi
 * lên — dữ liệu mẫu phải tuân đúng luật mà ứng dụng áp cho người dùng thật.
 */
export function generateAvatarPng(seedText, { width = 400, height = 500 } = {}) {
  const hash = crypto.createHash('sha256').update(String(seedText)).digest();
  const hue = hash[0] * 360 / 256;
  const top = hslToRgb(hue, 0.62, 0.6);
  const bottom = hslToRgb((hue + 45) % 360, 0.6, 0.42);

  // Bỏ dấu trước khi tra bảng chữ: "Đạt" → "D", "Ương" → "U".
  const asciiLetter = String(seedText)
    .trim()
    .split(/\s+/)
    .pop()
    ?.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toUpperCase()?.[0] ?? 'V';
  const glyph = FONT[asciiLetter] ?? FONT.V;

  // Khối chữ 5×7. Giữ ô nhỏ vừa phải: phóng quá to thì các nét chéo của phông
  // bitmap tách rời nhau và nhìn như những khối vuông rạc.
  const scale = Math.max(2, Math.floor(width / 18));
  const glyphW = 5 * scale;
  const glyphH = 7 * scale;
  const gx = Math.floor((width - glyphW) / 2);
  const gy = Math.floor(height * 0.4 - glyphH / 2);

  // Vòng tròn sáng mờ phía sau chữ, cho giống ảnh đại diện thật.
  const cx = width / 2;
  const cy = height * 0.4;
  const radius = Math.min(width, height) * 0.22;

  const raw = Buffer.alloc((width * 3 + 1) * height);
  let p = 0;
  for (let y = 0; y < height; y += 1) {
    raw[p] = 0; // bộ lọc dòng: none
    p += 1;
    const t = y / (height - 1);
    const base = [
      Math.round(top[0] + (bottom[0] - top[0]) * t),
      Math.round(top[1] + (bottom[1] - top[1]) * t),
      Math.round(top[2] + (bottom[2] - top[2]) * t),
    ];
    for (let x = 0; x < width; x += 1) {
      let [r, g, b] = base;

      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) {
        r = Math.round(r + (255 - r) * 0.18);
        g = Math.round(g + (255 - g) * 0.18);
        b = Math.round(b + (255 - b) * 0.18);
      }

      if (glyph && x >= gx && x < gx + glyphW && y >= gy && y < gy + glyphH) {
        const col = Math.floor((x - gx) / scale);
        const row = Math.floor((y - gy) / scale);
        if ((glyph[row] >> (4 - col)) & 1) {
          r = 255; g = 255; b = 255;
        }
      }

      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b;
      p += 3;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // độ sâu bit
  ihdr[9] = 2;   // màu truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Ghi ảnh đại diện mặc định ra tệp, trả về đường dẫn công khai. */
export function writeAvatar(seedText) {
  ensureDir();
  const name = `avatar-${crypto.createHash('sha256').update(String(seedText)).digest('hex').slice(0, 16)}.png`;
  fs.writeFileSync(path.join(uploadDir, name), generateAvatarPng(seedText));
  return `/uploads/${name}`;
}
