# Kiểm tra ngày 2026-10-19

## Đã thực hiện

- `npm run lint`: qua.
- `npm run typecheck`: qua.
- `npm run build`: qua, Nest ESM build bằng TypeScript.
- `npm run format:check`: qua.
- `npm test`: **14/14** qua. Test HTTP cần được phép mở loopback; sandbox ban đầu chặn listen bằng EPERM, chạy lại với quyền loopback đã qua.
- `npm audit --omit=dev`: 0 vulnerabilities tại thời điểm kiểm tra.
- Startup `npm start` với `.env` local mẫu: qua, giữ server cổng 4000 để review.
- HTTP `/health/live`: 200; `/docs`: 200; `/openapi.json`: 200, 33 paths, DTO có labourBps.
- HTTP `/health/ready`: **503**, đúng với tình trạng chưa kết nối Postgres local. Không coi API dữ liệu production đã sẵn sàng.

## Phạm vi 14 bài API test

1. Catalog đúng asset/rule FE; giá chưa có là null, sản phẩm draft không lộ public.
2. Phân trang có giới hạn, cursor, field lạ bị từ chối, OpenAPI/health.
3. Một kính, tối đa ba rêu, không ID trùng hoặc không hợp lệ.
4. Google token ký RSA/JWKS local, nonce một lần, user theo Google sub, thu hồi session.
5. Admin role, revision/If-Match, giá phải đi cùng đơn vị, audit atomic.
6. Policy chưa đủ chặn quote; giá tính từ DB, không nhận tiền FE gửi; giới hạn rêu.
7. Công 50% và cọc 50%, làm tròn lên khi có phần lẻ một đồng.
8. Retry cùng key, owner isolation, snapshot phiếu đơn không đổi theo catalog.
9. Quote hết hạn hoặc catalog thay đổi bị từ chối khi chốt đơn.
10. Chuyển khoản không trùng reference/không vượt tiền hàng; không hoàn tất đơn thiếu tiền.
11. Production từ chối TLS DB bị tắt và CORS wildcard.
12. Admin tạo/publish sản phẩm, portfolio, sửa About; bể sẵn không cộng công custom.
13. Gửi retry song song chỉ tạo một order/invoice; danh sách private phân trang.
14. JSON hỏng/body quá lớn trả lỗi client, seed lại không ghi đè giá admin đã sửa.

## Giới hạn thực tế

- SQL và transaction chạy bằng PGlite (PostgreSQL WASM) tạm trong test. Chưa chạy suite qua PostgreSQL TCP/TLS, chưa thử pooler/autoscale Vercel hoặc migration CLI trên server thật. Docker daemon local đang tắt.
- Chưa có DATABASE_URL hosted, Google client thật, ngân hàng hoặc deploy Vercel. Không tuyên bố Google browser login, tiền ngân hàng, latency hay tải production đã kiểm chứng.
- Không có browser surface khả dụng trong phiên này; Swagger mới được kiểm tra qua HTTP/OpenAPI, chưa xác nhận giao diện bằng trình duyệt.
- FE hiện chưa nối API; không kiểm tra checkout end-to-end trên trình duyệt hoặc thiết bị thật trong lần này.
- WAF/rate limit và lịch cleanup cần cấu hình lúc deploy. Cleanup script chỉ được kiểm tra type/lint, chưa chạy trên dữ liệu vận hành.
- Concurrency test trên PGlite không thay thế stress test nhiều kết nối thực với PostgreSQL; cần chạy nhánh TEST_DATABASE_URL trong môi trường test trước go-live.

Xem README để chạy DB, migrate/seed và test PostgreSQL riêng. Không xóa hoặc thay source FE/reference asset trong phạm vi này.

## Admin password extension · 26/10/2026

`typecheck`, `lint`, `format:check`, `build` PASS. Integration suite 21/21 PASS với PGlite, có kiểm tra password hash/salt, normalized email, role/active restrictions, generic login error, limiter, session revocation và chính logic CLI `saveAdminPassword` cho create/reset/disabled account. Giao diện admin đã gọi BE demo qua browser cho login, request status, payment deposit và catalog create. Chưa chạy migration 009 hoặc CLI trên PostgreSQL thật; không tạo tài khoản production. Xem `../terrarila-admin/VALIDATION.md` cho chi tiết kiểm tra UI và giới hạn.

## Media filesystem · 28/10/2026

Đã chuyển 51 file từ FE với đối chiếu SHA-256; ảnh/model ở storage/assets, docs ở reference/fe-docs không public. Typecheck/lint/build đạt; 23/23 API tests PGlite đạt, gồm upload ảnh thật và gắn vào catalog, phân quyền, định dạng/kích thước, metadata/audit và static errors. Migration 011–012 áp thành công trên PostgreSQL local; health/ready báo database ready. Ảnh gốc tải qua BE4000, FE3000 và admin3002 đều HTTP200 cùng byte. Compose volume được kiểm tra cấu hình; chưa chạy container backend hoặc triển khai object storage/Vercel.

Chrome smoke test: đăng nhập tài khoản demo trong DB tạm, chọn PNG thật từ file dialog, thấy preview trả từ BE, lưu vật liệu thành công; GET catalog xác nhận imageUrl uploads và revision mới. Dữ liệu catalog thật không bị sửa bởi smoke test.

## Ảnh highlight bể bán sẵn · 28/10/2026

Migration 013 đã áp PostgreSQL local. BE 23/23 API tests đạt, kiểm tra tạo/đọc/xóa tham chiếu highlight, URL không hợp lệ và revision. Admin 15/15 tests đạt, gồm upload highlight riêng với gallery và gửi đúng If-Match. FE 11/11 tests đạt; typecheck/build cả ba đạt, lint BE/FE không lỗi (FE còn 3 warning unused cũ). Next 16.4.0 nhắc nâng cấp bảo mật; build hoàn tất sau retry.

Chrome smoke test trên DB demo riêng: chọn PNG highlight bằng file dialog, upload và lưu thành công; public API trả đúng URL; FE hiển thị ảnh chính trước hover và ảnh có chú thích khi hover. FE thật đọc sản phẩm published từ API, không gắn ảnh hover cố định khi highlight null. Không thay ảnh hoặc giá của sản phẩm trong PostgreSQL thật.
