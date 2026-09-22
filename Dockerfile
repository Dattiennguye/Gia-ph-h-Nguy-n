# syntax=docker/dockerfile:1

FROM node:22-alpine

# Chạy bằng người dùng không có quyền root.
WORKDIR /app

# Cài phụ thuộc trước, tách khỏi mã nguồn để tận dụng cache khi build lại.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Dữ liệu và ảnh nằm ngoài image, gắn volume vào hai thư mục này.
RUN mkdir -p /app/data /app/uploads && chown -R node:node /app/data /app/uploads
USER node

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/vigo-match.db \
    UPLOAD_DIR=/app/uploads

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/meta/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
