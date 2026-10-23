# Danh mục vật liệu: BE là nguồn duy nhất

Đã chuyển 21 option trong 5 bước từ FE sang `scripts/catalog-seed.json`: 3 bể, 2 sỏi, 2 đất, 7 rêu và 7 cây. Tên, mô tả, ảnh và thứ tự khớp `steps` tại thời điểm đồng bộ. Các file ảnh vẫn nằm trong `terrarila-fe/public/assets`; BE lưu đường dẫn URL tương ứng, không lưu bản sao ảnh.

## Cập nhật database hiện có

Trong thư mục backend:

```sh
npm run db:migrate
npm run db:sync-catalog
```

`db:sync-catalog` là thao tác đồng bộ nội dung hiển thị có chủ đích: cập nhật tên, mô tả, URL ảnh và thứ tự từ file seed. Giữ nguyên UUID, legacyId, giá, đơn vị, tình trạng hàng và cờ công bố; không tạo trùng vật liệu. Revision chỉ tăng khi nội dung thực sự đổi. Công thức của bể mẫu giữ nguyên liên kết UUID. Seed thông thường `db:seed` tiếp tục giữ các chỉnh sửa đã có trên database.

Khi đã quản lý danh mục trực tiếp ở BE, không chạy lệnh sync này chỉ để thêm một vật liệu; dùng API admin để thêm hoặc sửa vật liệu, rồi tải lại trang FE.

PostgreSQL local phải chạy trước. Nếu cổng 5432 chưa hoạt động, lệnh sẽ dừng và chưa áp dụng thay đổi.

## Demo

`npm run docs:demo` tạo database tạm riêng và tự chạy migration/seed mới. Nếu server demo cũ đang chạy ở 4100, phải dừng và chạy lại mới lấy dữ liệu seed mới; dữ liệu demo trước đó mất khi server dừng. Không tự khởi động lại một phiên demo đang có dữ liệu người dùng.

Có thể mở API kiểm thử độc lập bằng `TERRALA_UI_PORT=4200 npm run docs:demo`. FE có thể kiểm tra với `TERRALA_API_URL=http://127.0.0.1:4200 TERRALA_BUILD_DIR=.next-sync-dev npm run dev -- --port 3100`. Đóng những server kiểm thử này khi xong, không đóng server người dùng đang chạy.

## FE

Server Component tải `/v1/material-categories`, `/v1/materials` có phân trang, `/v1/pricing`, `/v1/design-presets`. `buildSteps` chỉ chuyển đổi dữ liệu API thành cấu trúc render; không có danh sách vật liệu, ảnh hay giới hạn rêu dự phòng cố định trong FE.

Các nhóm `glass`, `gravel`, `soil`, `moss`, `plants` vẫn là cấu trúc form và draft hiện tại. Thêm vật liệu mới trong một trong các nhóm này sẽ tự xuất hiện khi tải lại trang, không cần thêm option vào code FE.

Tên, mô tả, ảnh, thứ tự, chế độ chọn và giới hạn đều lấy từ API. Preview bể và danh sách đã chọn dùng cùng dữ liệu này. Vật liệu không công bố bị loại khỏi API; vật liệu không khả dụng vẫn có thể hiển thị nhưng không cho chọn mới. Ảnh thiếu có placeholder.

Redux Persist giữ các legacyId cũ để không mất bản nháp sau chuyển đổi. Khi có danh mục, chỉ giữ ID còn tồn tại và áp dụng giới hạn hiện tại của API. Khi API lỗi, giữ bản nháp thay vì xóa; form báo không tải được danh mục và không dựng danh sách mock. Vật liệu tạm không khả dụng vẫn giữ trong bản nháp để người dùng xem/bỏ chọn và giữ khả năng gửi lại cùng yêu cầu khi cần.

## Kiểm tra

Test API kiểm tra sync không đổi giá, stock, publish flags, UUID hoặc công thức mẫu và không tạo bản ghi trùng. Test FE kiểm tra option mới từ API, thứ tự/ảnh/tên, giới hạn thay đổi, bể mẫu và khôi phục bản nháp khi offline.
