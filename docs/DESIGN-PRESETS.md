# Bể mẫu cho trang làm theo yêu cầu

Bể mẫu là cấu hình khởi đầu được phép chỉnh sửa, khác sản phẩm bán sẵn có giá cố định. Chọn mẫu thay toàn bộ vật liệu, giữ ghi chú. Giá dự kiến luôn tính lại từ vật liệu và chính sách giá hiện tại.

## Khởi tạo dữ liệu

Với PostgreSQL hiện có, chạy lần lượt trong thư mục backend:

```sh
npm run db:migrate
npm run db:seed
```

Migration `008_design_presets.sql` tạo bảng mẫu và liên kết vật liệu bằng khóa ngoại. Seed đọc `scripts/design-presets-seed.json`; chạy lại không tạo trùng hay ghi đè mẫu đã chỉnh. Giá thật của vật liệu mới vẫn để trống cho tới khi shop xác nhận.

Để thử với dữ liệu tạm, dùng `npm run docs:demo`. Chế độ này tự chạy migration/seed trên PGlite riêng và dùng bảng giá demo. Không ghi vào PostgreSQL thật. Tắt server thì dữ liệu tạm mất.

## API

`GET /v1/design-presets?limit=24&cursor=...`

Trả `{ items, nextCursor }`. Mỗi mẫu có `id`, `slug`, `name`, `description`, `imageUrl`, `isDemo`, `materials`, `selectable`. `materials` chứa đầy đủ UUID, category, legacyId, tên, giá và tình trạng hiện tại. API dùng chung ConfigurationService để kiểm tra giới hạn lựa chọn. Nếu một vật liệu ẩn, không hoạt động, không khả dụng hoặc cấu hình vi phạm giới hạn, trả `selectable: false` và không đưa cấu hình thiếu ra form. Lỗi hệ thống vẫn được báo như lỗi API.

Chưa có màn hình hay endpoint quản trị riêng cho bể mẫu; dữ liệu khởi tạo nằm trong file seed. Không dùng endpoint sản phẩm bán sẵn để sửa công thức mẫu.

## Mẫu đầu tiên

Ảnh `/assets/products/attempt-1.jpg`, tên “Khu vườn đứng · Attempt 1”, gắn nhãn demo. Công thức đã được chủ shop duyệt để thử tự điền, không xác nhận thành phần thực tế trong ảnh:

- Bể chữ nhật đứng.
- Sỏi tự nhiên.
- Đất trồng và đất kết dính.
- Rêu Cỏ và Rêu Quyển Bá.
- Cẩm nhung và Quyển bá đỏ.

## FE

`loadBuilderCatalog` tải mẫu từ API. Nếu endpoint mẫu lỗi, khách vẫn tự chọn từ Bước 1; không chèn công thức dự phòng cố định trên FE. Mẫu chỉ áp dụng khi tất cả vật liệu đều còn trong danh mục và form biểu diễn được đầy đủ.

Một action Redux thay toàn bộ selection, giữ note và xóa khóa gửi yêu cầu cũ. Redux Persist hiện có lưu cấu hình; trạng thái mẫu được suy ra từ lựa chọn hiện tại, nên không có một bản sao cấu hình hay ID mẫu lưu riêng dễ bị lệch. Sau khi chỉnh vật liệu, mẫu không còn đánh dấu đang dùng nếu công thức khác đi.

## Kiểm tra và đóng server

Chạy `npm test` cho cả hai dự án; kiểm tra build/lint và thao tác chọn mẫu, chỉnh lại, reload trên browser. Đóng các server do quá trình kiểm tra mở khi xong, rồi xác nhận cổng đã ngừng lắng nghe.
