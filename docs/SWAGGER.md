# Xem backend bằng Swagger UI

- Backend thật: `npm run dev`, mở http://127.0.0.1:4000/docs.
- Demo riêng: `npm run docs:demo`, mở http://127.0.0.1:4100/docs. Demo seed dữ liệu vào PGlite trong bộ nhớ, mất khi dừng; không đọc .env và không ghi database thật.
- OpenAPI JSON cùng host tại `/openapi.json`.

Mở Catalog → GET /v1/materials → Try it out → Execute để xem dữ liệu JSON. Giá null là chưa cấu hình, không phải miễn phí. `/health/ready` kiểm tra database; giao diện tài liệu có thể chạy dù DB thật chưa kết nối.

Swagger mô tả API và cho gọi thử. Đây không phải giao diện sửa dữ liệu dạng bảng. Với dữ liệu quan hệ cần công cụ quản trị PostgreSQL riêng.

Các API có khóa vẫn yêu cầu quyền thật. `bearer` là accessToken từ Google login; `guest` là khóa phiên khách 64 ký tự hex do FE BFF tự tạo. Không lưu token trong URL hay localStorage. Phiên guest không thay thế role admin.


## Giá minh hoạ trong demo

Chỉ `npm run docs:demo` có bảng giá giả định này; production seed không đổi:

| Vật liệu | Giá mẫu VND |
| --- | ---: |
| Bể vuông | 150.000 |
| Bể chữ nhật ngang | 200.000 |
| Rêu (mỗi loại) | 30.000 |
| Cây (mỗi loại) | 25.000 |
| Sỏi (mỗi loại) | 10.000 |
| Đất (mỗi loại) | 15.000 |

Demo coi mỗi lựa chọn là một phần cho một bể (`per_selection`), công bằng 50% tiền vật liệu, cọc 50% tiền hàng, phí giao xác nhận riêng. Ví dụ bể vuông + một rêu: (150.000 + 30.000) × 1,5 = 270.000 VND. Đây là dữ liệu thử giao diện, không phải báo giá bán.

FE local phải trỏ `TERRALA_API_URL=http://127.0.0.1:4100` rồi reload trang builder để lấy giá mới.
