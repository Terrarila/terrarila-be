# Petite Terre API

NestJS 12 + TypeScript (ESM), Node.js 24, PostgreSQL. Source nằm riêng trong `terrarila-be`; phục vụ API và tài nguyên `/assets` cho FE/admin.

## Chạy local

```sh
cd terrarila-be
npm ci
cp .env.example .env
# Cần Docker Desktop/daemon đang chạy:
docker compose up -d
npm run db:migrate
npm run db:seed
npm run dev
```

- API: http://localhost:4000
- Swagger: http://localhost:4000/docs
- OpenAPI: http://localhost:4000/openapi.json
- Liveness: `/health/live`; readiness có kiểm tra DB/schema: `/health/ready`.
- Nếu dùng Postgres có sẵn, bỏ Docker và sửa `DATABASE_URL`. Production bắt buộc `PG_SSL=verify-full`.
- `npm run build && npm start` chạy bản biên dịch. Không migrate/seed trong startup hoặc mỗi request.

## Cấu trúc

| Đường dẫn | Trách nhiệm |
| --- | --- |
| `src/catalog`, `src/configuration` | Danh mục public, nội dung website, kiểm tra lựa chọn |
| `src/auth`, `src/admin` | Google identity, session, phân quyền, sửa catalog và audit |
| `src/media`, `storage/assets` | Upload ảnh admin, metadata và file công khai; cấu hình volume qua `MEDIA_ROOT` |
| `src/orders` | Giá phía server, quote, order, phiếu đơn, ghi nhận chuyển khoản |
| `src/database`, `src/common` | Pool, transaction, cấu hình, lỗi, phân trang |
| `migrations` | SQL đánh số, có checksum, chỉ thêm migration mới |
| `scripts` | Migrate, seed, cấp admin và dọn session hết hạn |
| `test` | Kiểm tra API + PostgreSQL engine qua PGlite hoặc database test riêng |

Đọc [FE–BE overview và phần còn thiếu](docs/FE-BE-OVERVIEW.md), [contract tích hợp](docs/INTEGRATION.md) và [kết quả kiểm tra](docs/VALIDATION.md).

## Chính sách đã xác nhận

- Bể custom: tổng nguyên liệu + **50% tổng nguyên liệu** tiền công.
- Cọc **50% tiền hàng**, chưa gồm ship. VND nguyên; phần lẻ dưới một đồng làm tròn lên ở từng phép tính công/cọc.
- Sản phẩm có sẵn dùng giá bán niêm yết, không cộng tiền công custom lần nữa.
- Nhận tại shop hoặc giao TP.HCM (`HCM`); phí giao shop xác nhận riêng, `shippingFeeVnd: null` nghĩa là chưa biết, không phải miễn phí.
- Invoice là phiếu đơn hàng JSON; chưa có PDF hay hóa đơn thuế.
- Một bể kính; tối đa ba loại rêu. Các giới hạn lấy từ category trong DB.

Migration cấu hình `labourBps=5000`, `depositBps=5000`, khu vực HCM. **Chưa bật nhận đơn ngay:** `quantityMode` còn để trống vì chưa chốt đơn vị tính giá. Admin cần chọn `per_selection` (mỗi option là một phần cho một bể) hoặc `quantity` (số đơn vị theo quote), nhập giá/đơn vị thật và xác nhận availability. Giá thiếu không được hiểu là 0. Seed không ghi đè dữ liệu đã sửa.

## Google và tài khoản quản trị

1. Tạo Google OAuth Web client, cấu hình JavaScript origin của FE; đặt `GOOGLE_CLIENT_ID` trong BE. Không cần client secret với luồng GIS ID token này.
2. FE lấy challenge, truyền nonce cho Google Identity Services, gửi ID token và challenge ID về BE. Chi tiết ở contract tích hợp.
3. Tài khoản đăng nhập lần đầu mặc định là customer; BE lưu Google `sub`, email đã xác minh, username/display name, avatar HTTPS. Không lưu Google access/refresh token.
4. Sau khi chính tài khoản quản trị đăng nhập, chạy trong môi trường tin cậy:

```sh
npm run admin:grant -- <google-sub-cua-user-da-dang-nhap>
```

Role không lấy từ request đăng ký hoặc email do FE gửi. Session ngẫu nhiên lưu hash trong DB, mặc định hết hạn sau một ngày, logout có thu hồi. FE nên giữ bearer trong cookie HttpOnly ở tầng BFF cùng host FE và chuyển tiếp sang BE; chưa triển khai BFF trong phạm vi này.

## Lưu ảnh và model

Ảnh website và GLB đã chuyển từ FE vào `storage/assets`; ảnh docs ở `reference/fe-docs` không phục vụ công khai. Admin upload file vào `storage/assets/uploads` và lưu metadata trong PostgreSQL. Xem [MEDIA.md](docs/MEDIA.md) để chạy với volume, cấu hình proxy và backup.

## Deploy Vercel

Có adapter Vercel Blob và luồng upload trực tiếp private staging → kiểm tra bytes → WebP public. Trên Vercel bắt buộc MEDIA_STORAGE=vercel-blob; không dùng ổ đĩa tạm để lưu media. Cần migrations đến 016, PostgreSQL hosted/TLS, hai Blob stores riêng và chuyển media hiện có trước khi kiểm tra Preview.

Hướng dẫn tài khoản, Neon Free qua Marketplace, ba project/env, chuyển assets và acceptance: [VERCEL-PREVIEW.md](docs/VERCEL-PREVIEW.md). Repo này độc lập: Root Directory là gốc repo (`.`), Node 24.x, native NestJS src/main.ts. Pool được attach vào lifecycle Vercel; không migrate/seed trong mỗi request hoặc startup function.

Các local tests dùng PGlite và Blob store giả không chứng minh upload Blob/Google Drive/hosted PostgreSQL đã chạy thật trên Preview. Backup filesystem và metrics theo process vẫn cần vận hành cloud phù hợp trước production.

## Kiểm tra và vận hành

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run format:check
npm audit
npm run auth:cleanup
```

`npm test` mặc định chạy DB tạm PGlite, không chạm DB ứng dụng. Để kiểm tra PostgreSQL qua TCP/TLS, truyền `TEST_DATABASE_URL` của **database test riêng** và `TEST_PG_SSL=verify-full` nếu hosted: suite tạo schema UUID riêng, rồi xóa schema đó khi xong. User test cần quyền tạo schema. Không dùng tài khoản production cho test.

Job `auth:cleanup` chỉ xóa challenge/session hết hạn hoặc thu hồi lâu hơn một ngày, tối đa 5.000 bản ghi mỗi loại mỗi lần; không xóa đơn/phiếu đơn/thanh toán. Chạy định kỳ bằng scheduler ngoài request. Không tự thêm cron public không có xác thực.
