/** Lỗi có mã HTTP — ném ra ở bất kỳ đâu, middleware cuối sẽ bắt và trả JSON. */
export class ApiError extends Error {
  constructor(status, code, message, detail) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export const badRequest = (msg, detail) => new ApiError(400, 'bad_request', msg, detail);
export const unauthorized = (msg = 'Bạn cần đăng nhập') => new ApiError(401, 'unauthorized', msg);
export const forbidden = (msg = 'Bạn không có quyền thực hiện việc này') =>
  new ApiError(403, 'forbidden', msg);
export const notFound = (msg = 'Không tìm thấy') => new ApiError(404, 'not_found', msg);
export const conflict = (msg, detail) => new ApiError(409, 'conflict', msg, detail);
export const tooMany = (msg = 'Bạn thao tác quá nhanh, thử lại sau ít phút') =>
  new ApiError(429, 'rate_limited', msg);

/** Bọc handler async để lỗi được đẩy sang middleware xử lý lỗi. */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function errorHandler(err, req, res, _next) {
  // Lỗi do bộ đọc JSON của Express: dữ liệu quá lớn hoặc JSON sai cú pháp.
  // Đây là lỗi của phía gửi, phải trả 4xx kèm thông báo đọc được — không phải
  // 500 "lỗi máy chủ" làm người dùng tưởng hệ thống hỏng.
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'payload_too_large',
      message: 'Dữ liệu gửi lên quá lớn. Ảnh tối đa 1.5MB.',
    });
  }
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({
      error: 'bad_json',
      message: 'Dữ liệu gửi lên không phải JSON hợp lệ.',
    });
  }

  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: err.code,
      message: err.message,
      ...(err.detail ? { detail: err.detail } : {}),
    });
  }
  console.error('[error]', req.method, req.path, err);
  return res.status(500).json({
    error: 'internal_error',
    message: 'Có lỗi xảy ra phía máy chủ. Vui lòng thử lại.',
  });
}
