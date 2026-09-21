# 💞 Vigo Match

> Nền tảng tìm người phù hợp với **nhu cầu sống và mục tiêu lâu dài** — không phải một app để vuốt cho vui.

Ba trụ cột: **📍 Gần bạn · 🎯 Đúng nhu cầu · ❤️ Phù hợp lâu dài**

Đây là một ứng dụng chạy thật, không phải bản demo: người dùng thật đăng ký, tạo
hồ sơ, được ghép đôi bằng thuật toán trên dữ liệu thật, nhắn tin thời gian thực,
báo cáo và bị kiểm duyệt. Toàn bộ chạy được bằng `npm install && npm start`.

---

## Chạy thử trong 30 giây

```bash
npm install
cp .env.example .env      # có thể dùng nguyên mặc định khi phát triển
npm run seed              # tạo ~200 hồ sơ mẫu quanh Hà Nội và TP.HCM
npm start                 # http://localhost:3000
```

Đăng nhập bằng tài khoản mẫu: **`dat@vigomatch.test`** / **`matkhau123`**

Yêu cầu **Node 22.5 trở lên** — cơ sở dữ liệu dùng `node:sqlite` có sẵn, không
phải biên dịch gì.

Để mở trang quản trị, đặt `ADMIN_EMAIL` và `ADMIN_PASSWORD` trong `.env` rồi khởi
động lại; tài khoản quản trị sẽ được tạo tự động, truy cập tại `/admin.html`.

```bash
npm test      # 75 bài kiểm thử
npm run reset # xoá sạch dữ liệu
```

---

## Điều làm nên khác biệt

### 1. Hai loại tiêu chí, tách bạch rõ ràng

Đây là phần cốt lõi của sản phẩm.

| Loại | Ví dụ | Hệ quả |
| --- | --- | --- |
| **Bắt buộc** | "Không hút thuốc" | Người hút thuốc **bị loại hẳn** khỏi kết quả |
| **Ưu tiên** | "Biết nấu ăn" | Người không biết nấu ăn **vẫn xuất hiện**, chỉ xếp sau |

Nhờ vậy thuật toán không cứng nhắc: bạn nói rõ điều không nhân nhượng được, và
điều chỉ là mong muốn.

Bộ lọc bắt buộc chạy **hai chiều** — hệ thống không giới thiệu người đã loại bạn
ra khỏi tiêu chí của họ. Tôn trọng cả hai phía.

### 2. Không phô con số, mà giải thích

Thay vì nói "hợp nhau 87%", app nói:

```
Hai bạn có 6 điểm chung quan trọng
  ✓ Cùng tìm người kết hôn
  ✓ Cùng quan điểm: muốn kết hôn sớm
  ✓ Cùng muốn có con
  ✓ Cách nhau khoảng 5.9 km
  ✓ Lối sống giống nhau: thích ở nhà, thích du lịch
  ✓ Cùng muốn sống gần gia đình

1 điểm cần cân nhắc
  △ Bạn muốn sống gần gia đình, người ấy muốn sống riêng
```

Điểm số vẫn được tính, nhưng hiển thị dưới dạng mức độ ("Rất phù hợp", "Phù hợp
cao"...) kèm lý do cụ thể. Trọng số:

| Tiêu chí | Trọng số |
| --- | --- |
| Mục đích quan hệ | 20% |
| Quan điểm hôn nhân | 15% |
| Khoảng cách | 15% |
| Tiêu chí cá nhân | 15% |
| Muốn có con | 10% |
| Độ tuổi | 10% |
| Lối sống | 10% |
| Sở thích | 5% |

Hồ sơ thiếu dữ liệu vẫn ghép được: trọng số của phần thiếu được chia lại cho các
phần còn lại, và kết quả kèm theo độ tin cậy thấp hơn.

### 3. AI Matchmaker phân tích bằng số liệu thật

Không phải chatbot tình yêu. Nó đếm trên kho hồ sơ đang có và nói cho bạn biết
cái giá của từng tiêu chí:

```
Tăng bán kính lên 30 km sẽ có thêm 3 người phù hợp
  Bạn đang tìm trong 20 km và có 4 hồ sơ phù hợp. Mở rộng lên 30 km,
  con số đó thành 7.                                    [Đổi thành 30 km]

Bạn đang đặt 5 tiêu chí bắt buộc
  Có 2 tiêu chí đang loại phần lớn hồ sơ: "Hút thuốc: Không hút thuốc"
  (loại 41%) và "Học vấn: từ Thạc sĩ trở lên" (loại 33%).
```

Kèm công cụ **thử trước**: xem trước kết quả thay đổi thế nào mà không đụng vào
nhu cầu thật của bạn.

Toàn bộ phần này chạy **không cần API key nào**. Nếu cấu hình `ANTHROPIC_API_KEY`,
hệ thống nhờ Claude viết thêm một đoạn nhận xét bằng lời **dựa trên chính các con
số đã tính** — model không được phép bịa số liệu.

### 4. Vị trí: đủ gần để hữu ích, đủ mờ để an toàn

Đây là yêu cầu an toàn, không phải tính năng phụ.

- Toạ độ thật **chỉ tồn tại phía máy chủ** để tính khoảng cách. API không bao giờ
  trả về `lat`/`lng` của người khác — có bài kiểm thử tự động canh việc này.
- Khu vực hiển thị **luôn lùi lên cấp quận/huyện**. Bạn khai "Thượng Phúc, Thường
  Tín, Hà Nội" thì người khác chỉ thấy *"Thường Tín, Hà Nội"*.
- Khoảng cách luôn làm tròn: *"Khoảng 5.9 km"*, *"Cùng khu vực"*.
- Bản đồ vẽ bằng canvas ngay trên máy, **không gọi dịch vụ bản đồ bên ngoài** —
  toạ độ của người dùng không bao giờ rời khỏi hệ thống. Mỗi chấm còn bị xê dịch
  ngẫu nhiên vài trăm mét (ổn định theo từng người).

### 5. An toàn và chống lừa đảo có thể đọc được

Mọi tin nhắn đi qua bộ quét trước khi lưu. Không phải hộp đen — mỗi tín hiệu là
một luật đọc được, có điểm rủi ro riêng:

| Trạng thái | Xử lý |
| --- | --- |
| `clean` | Gửi bình thường |
| `warned` | Vẫn gửi, **người nhận** thấy cảnh báo, mở ca theo dõi |
| `blocked` | Không gửi, mở ca kiểm duyệt mức cao, **tạm khoá tài khoản ngay** |

Phát hiện: xin tiền / số tài khoản, dụ đầu tư "lãi suất cao", hỏi mã OTP, gửi
link lạ, rủ chuyển nền tảng quá sớm, tạo áp lực gấp gáp, và **spam hàng loạt**
(cùng một nội dung gửi cho nhiều người).

Điểm quan trọng: khi một tin bị chặn, hệ thống vẫn **ghi lại đầy đủ hồ sơ kiểm
duyệt** — việc ghi nhận nằm ngoài giao dịch lưu tin nhắn, nên hành vi xấu không
bao giờ biến mất cùng với tin bị từ chối.

### 6. Bài toán "con gà và quả trứng"

App dạng này chết vì mật độ, không phải vì tính năng. Trang quản trị có bảng mật
độ theo tỉnh/thành kèm **tỷ lệ nam/nữ**, và nút mở/đóng đăng ký cho từng khu vực:

```
Hà Nội            79 người   nam/nữ = 0.88   cân đối        [Đang mở]
Hải Dương         10 người   nam/nữ = 2.33   ⚠ lệch nhiều   [Đang mở]
```

---

## Kiến trúc

```
┌──────────────────────────────────────────────┐
│  Giao diện — JS thuần, không build, 5 tab    │
│  public/  app.js · screens.js · me.js …      │
└───────────────────┬──────────────────────────┘
                    │  REST + SSE
┌───────────────────▼──────────────────────────┐
│  API — Express                               │
│  routes/  auth · profile · discovery ·       │
│           social · billing · admin           │
├──────────────────────────────────────────────┤
│  Nghiệp vụ                                   │
│  services/  auth · profiles · discovery ·    │
│             interactions · chat ·            │
│             moderation · billing · admin     │
├──────────────────────────────────────────────┤
│  Lõi thuần — không phụ thuộc DB, dễ kiểm thử │
│  domain/  matching · safety · insights ·     │
│           icebreaker · taxonomy              │
├──────────────────────────────────────────────┤
│  SQLite (node:sqlite, WAL) — 28 bảng         │
└──────────────────────────────────────────────┘
```

Phụ thuộc ngoài: **express**, **dotenv**, và **@anthropic-ai/sdk** (chỉ dùng khi
bật AI). Không bundler, không framework, không bước build.

### Tách ba tầng dữ liệu ngay từ đầu

**User ≠ Profile ≠ Preference**

- `users` — danh tính và quyền truy cập
- `profiles` — con người, thứ người khác nhìn thấy
- `preferences` + `preference_rules` — "tôi đang tìm ai"

Ba thứ này thay đổi với tốc độ khác nhau và thuộc về ba màn hình khác nhau. Gộp
chung là tự trói tay mình về sau.

### Hệ thống khu vực

`Quốc gia → Tỉnh/Thành → Quận/Huyện → Xã/Phường`, kèm toạ độ thật (WGS84):
**63 tỉnh/thành · 264 quận/huyện** cùng một số xã/phường. Khoảng cách tính bằng
công thức haversine, lọc thô bằng hộp bao trong SQL trước khi tính chính xác.

---

## Cấu trúc dự án

```
src/
  index.js              Express: gắn route, phục vụ giao diện tĩnh
  config.js             biến môi trường → cấu hình có kiểu
  db/
    schema.sql          28 bảng, khoá ngoại, chỉ mục
    index.js            node:sqlite, WAL, transaction lồng nhau bằng SAVEPOINT
  domain/               lõi thuần — không chạm DB, kiểm thử trực tiếp
    matching.js         điểm phù hợp, lọc cứng hai chiều, sinh lời giải thích
    safety.js           luật phát hiện lừa đảo & spam
    insights.js         phân tích tiêu chí cho AI Matchmaker
    icebreaker.js       câu mở lời sinh từ điểm chung thật
    taxonomy.js         toàn bộ lựa chọn, dùng chung server ↔ client
  services/             nghiệp vụ, chạm DB
  routes/               tầng HTTP: kiểm tra đầu vào, gọi service
  lib/                  crypto · geo · validate · rateLimit · events(SSE) · ai
  middleware/auth.js    phiên, xác minh SĐT, phân quyền

public/                 giao diện, không build
data/regions.vn.js      địa giới Việt Nam kèm toạ độ
scripts/seed.js         sinh dữ liệu mẫu
test/                   75 bài kiểm thử
```

---

## API

Tất cả dưới `/api`. Xác thực bằng `Authorization: Bearer <token>`.

<details>
<summary><b>Xác thực</b></summary>

| | |
| --- | --- |
| `POST /auth/register` | đăng ký bằng `phone` hoặc `email` |
| `POST /auth/oauth` | Google / Apple |
| `POST /auth/login` | email hoặc SĐT + mật khẩu |
| `POST /auth/login/otp/send` · `/verify` | đăng nhập không cần mật khẩu |
| `POST /auth/phone/send-otp` · `/verify` | xác minh SĐT (bắt buộc) |
| `GET /auth/me` · `POST /auth/logout` | phiên hiện tại |
| `GET /auth/sessions` · `POST /auth/sessions/revoke-all` | quản lý thiết bị |
</details>

<details>
<summary><b>Hồ sơ & nhu cầu</b></summary>

| | |
| --- | --- |
| `GET/PATCH /profile` | hồ sơ của chính mình |
| `GET /profile/overview` | hồ sơ + nhu cầu + quyền lợi + huy hiệu, cho tab "Tôi" |
| `POST /profile/location` | cập nhật vị trí thiết bị |
| `POST/DELETE /profile/photos` | ảnh |
| `GET/PATCH /profile/preference` | nhu cầu |
| `POST/DELETE /profile/preference/rules` | tiêu chí bắt buộc / ưu tiên |
</details>

<details>
<summary><b>Khám phá & ghép đôi</b></summary>

| | |
| --- | --- |
| `GET /discovery/feed` | bảng khám phá đã xếp hạng |
| `GET /discovery/daily` | "Hôm nay dành cho bạn" — cố định trong ngày |
| `GET /discovery/nearby` | bản đồ mật độ, toạ độ đã làm mờ |
| `GET /discovery/profile/:id` | hồ sơ + "vì sao chúng tôi đề xuất người này" |
| `POST /discovery/react` | thích / bỏ qua / thích đặc biệt |
| `GET /discovery/matchmaker` | báo cáo AI Matchmaker |
| `POST /discovery/matchmaker/simulate` | thử thay đổi tiêu chí |
</details>

<details>
<summary><b>Xã hội</b></summary>

| | |
| --- | --- |
| `GET /social/matches` · `/likes/received` | kết đôi, ai đã thích bạn |
| `GET/POST /social/conversations/:id/messages` | trò chuyện |
| `POST /social/conversations/:id/icebreaker` | đổi câu mở lời |
| `POST /social/block` · `/report` | chặn, báo cáo |
| `GET /social/stream` | SSE: tin nhắn, kết đôi, thông báo |
</details>

<details>
<summary><b>Quản trị</b> (<code>admin</code> / <code>moderator</code>)</summary>

| | |
| --- | --- |
| `GET /admin/dashboard` · `/timeseries` | số liệu |
| `GET /admin/regions/density` | mật độ & tỷ lệ giới tính theo tỉnh |
| `POST /admin/regions/:id/signup` | mở/đóng đăng ký theo khu vực |
| `GET /admin/users/:id` | hồ sơ đầy đủ (**không** gồm nội dung giấy tờ) |
| `POST /admin/users/:id/status` | cảnh cáo / khoá / mở lại |
| `GET /admin/cases` · `POST /admin/cases/:id/resolve` | hàng đợi kiểm duyệt |
| `GET /admin/verifications` · `POST .../review` | duyệt xác minh |
| `GET /admin/audit` | nhật ký kiểm toán (chỉ ghi thêm) |
</details>

---

## Bảo mật & quyền riêng tư

| | |
| --- | --- |
| Mật khẩu | scrypt (N=16384), so sánh thời gian hằng định |
| Phiên | token ngẫu nhiên 32 byte, **lưu dạng băm** trong DB, thu hồi được |
| Dữ liệu giấy tờ | AES-256-GCM; không bao giờ xuất hiện trong bất kỳ response nào, kể cả với quản trị viên |
| Số giấy tờ | băm SHA-256 để phát hiện một người mở nhiều tài khoản |
| OTP | băm trước khi lưu, có hạn dùng, giới hạn số lần thử |
| Giới hạn tần suất | lưu trong SQLite, sống sót qua khởi động lại |
| SQL | tham số hoá toàn bộ, không nối chuỗi |
| Vị trí | toạ độ không rời máy chủ; khu vực lùi cấp; khoảng cách làm tròn |
| Liệt kê tài khoản | phản hồi giống hệt nhau dù tài khoản có tồn tại hay không |
| Kiểm toán | mọi hành động quản trị đều được ghi lại kèm người thực hiện |

Khi chạy thật (`NODE_ENV=production`), máy chủ **từ chối khởi động** nếu chưa đặt
`SESSION_SECRET` và `PII_ENCRYPTION_KEY`, và `EXPOSE_OTP` tự động tắt.

---

## Kiểm thử

```
npm test    # 75 bài, ~2 giây
```

| Tệp | Nội dung |
| --- | --- |
| `auth.test.js` | đăng ký, đăng nhập, OTP, chuẩn hoá SĐT, chặn dưới 18 tuổi |
| `matching.test.js` | điểm phù hợp, lọc hai chiều, must vs prefer, hồ sơ thiếu dữ liệu |
| `safety.test.js` | phát hiện lừa đảo, spam hàng loạt, tin nhắn bình thường không bị oan |
| `flow.test.js` | khám phá → thích → kết đôi → trò chuyện → chặn, và **kiểm tra rò rỉ dữ liệu** |
| `moderation.test.js` | chặn tin lừa đảo, tự động tạm khoá, khôi phục, phân quyền, kiểm toán |
| `preference.test.js` | tác động của tiêu chí, thử nghiệm thay đổi, gói dịch vụ, xác minh |
| `ratelimit.test.js` | chống thử mật khẩu và spam OTP |

Mỗi tệp dùng một cơ sở dữ liệu riêng và gọi qua HTTP như một client thật.

---

## Lộ trình

- [x] **P0 — Nền tảng**: đăng ký, hồ sơ, khu vực, nhu cầu, bảo mật
- [x] **P1 — Hẹn hò**: khám phá, bộ lọc, ghép đôi, chat, chặn, báo cáo, thông báo
- [x] **P2 — Ghép đôi thông minh**: điểm phù hợp, lời giải thích, gợi ý hằng ngày, AI Matchmaker, câu mở lời
- [x] **P3 — Kinh doanh**: Premium, thanh toán, boost, xác minh, quản trị, kiểm duyệt, phân tích
- [ ] Tiếp theo: ứng dụng di động, đẩy thông báo, xác minh khuôn mặt tự động, tải ảnh lên lưu trữ ngoài

---

## Ghi chú khi triển khai thật

Các điểm cần thay trước khi mở cho người dùng thật:

1. **SMS** — đặt `SMS_PROVIDER=http` và trỏ `SMS_WEBHOOK_URL` tới nhà cung cấp
   (Twilio, eSMS, Viettel...). Mặc định `console` chỉ in ra terminal.
2. **OAuth** — `POST /auth/oauth` đã kiểm tra token Google qua endpoint chính
   thức; phần Apple cần bổ sung kiểm tra khoá công khai.
3. **Ảnh** — hiện lưu dưới dạng data URI trong DB, đủ dùng để chạy thử. Khi có
   người dùng thật nên chuyển sang lưu trữ đối tượng (S3/R2) kèm quét nội dung.
4. **Thanh toán** — `PAYMENT_PROVIDER=mock` tự xác nhận. Dùng `manual` để đối
   soát chuyển khoản tay, hoặc nối VNPay/MoMo qua cùng một chỗ trong
   `services/billing.js`.
5. **Cơ sở dữ liệu** — SQLite chạy tốt tới hàng chục nghìn người dùng trên một
   máy. Lược đồ viết theo chuẩn SQL nên chuyển sang PostgreSQL không cần đổi
   thiết kế.
6. **Mở khu vực** — đừng mở toàn quốc ngay. Dùng bảng mật độ trong trang quản trị,
   mở từng tỉnh khi tỷ lệ giới tính đủ cân.

---

## Giấy phép

MIT
