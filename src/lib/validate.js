import { badRequest } from './http.js';
import { isValid } from '../domain/taxonomy.js';

/** Chuỗi bắt buộc, đã cắt khoảng trắng hai đầu. */
export function str(value, field, { min = 1, max = 500, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`Thiếu trường "${field}"`);
    return null;
  }
  const s = String(value).trim();
  if (s.length < min) throw badRequest(`"${field}" phải có ít nhất ${min} ký tự`);
  if (s.length > max) throw badRequest(`"${field}" không được quá ${max} ký tự`);
  return s;
}

export function int(value, field, { min, max, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`Thiếu trường "${field}"`);
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n)) throw badRequest(`"${field}" phải là số nguyên`);
  if (min !== undefined && n < min) throw badRequest(`"${field}" phải từ ${min} trở lên`);
  if (max !== undefined && n > max) throw badRequest(`"${field}" không được quá ${max}`);
  return n;
}

export function enumValue(value, group, field, { required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`Thiếu trường "${field}"`);
    return null;
  }
  if (!isValid(group, value)) throw badRequest(`Giá trị không hợp lệ cho "${field}": ${value}`);
  return value;
}

export function enumArray(value, group, field, { max = 30 } = {}) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw badRequest(`"${field}" phải là một danh sách`);
  if (value.length > max) throw badRequest(`"${field}" chọn tối đa ${max} mục`);
  const out = [];
  for (const v of value) {
    if (!isValid(group, v)) throw badRequest(`Giá trị không hợp lệ trong "${field}": ${v}`);
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

/** Ngày sinh YYYY-MM-DD, và phải đủ 18 tuổi. */
export function birthDate(value, field = 'birth_date', { required = true } = {}) {
  if (!value) {
    if (required) throw badRequest('Thiếu ngày sinh');
    return null;
  }
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw badRequest('Ngày sinh phải theo định dạng YYYY-MM-DD');
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw badRequest('Ngày sinh không hợp lệ');
  const age = (Date.now() - d.getTime()) / (365.2425 * 86400000);
  if (age < 18) throw badRequest('Bạn phải đủ 18 tuổi để sử dụng Vigo Match');
  if (age > 100) throw badRequest('Ngày sinh không hợp lệ');
  return s;
}

/** Số điện thoại Việt Nam, chuẩn hoá về dạng +84… */
export function phone(value, field = 'phone', { required = true } = {}) {
  if (!value) {
    if (required) throw badRequest('Thiếu số điện thoại');
    return null;
  }
  const raw = String(value).replace(/[\s.\-()]/g, '');
  let digits;
  if (/^\+84\d{9}$/.test(raw)) digits = raw.slice(3);
  else if (/^84\d{9}$/.test(raw)) digits = raw.slice(2);
  else if (/^0\d{9}$/.test(raw)) digits = raw.slice(1);
  else throw badRequest('Số điện thoại không hợp lệ. Ví dụ: 0912345678');
  if (!/^[35789]/.test(digits)) throw badRequest('Đầu số điện thoại không hợp lệ');
  return `+84${digits}`;
}

export function email(value, field = 'email', { required = true } = {}) {
  if (!value) {
    if (required) throw badRequest('Thiếu địa chỉ email');
    return null;
  }
  const s = String(value).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s) || s.length > 254) {
    throw badRequest('Địa chỉ email không hợp lệ');
  }
  return s;
}

export function password(value, field = 'password') {
  const s = String(value ?? '');
  if (s.length < 8) throw badRequest('Mật khẩu phải có ít nhất 8 ký tự');
  if (s.length > 200) throw badRequest('Mật khẩu quá dài');
  if (!/[a-zA-Z]/.test(s) || !/\d/.test(s)) {
    throw badRequest('Mật khẩu cần có cả chữ và số');
  }
  return s;
}

export function bool(value, field, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  throw badRequest(`"${field}" phải là true hoặc false`);
}
