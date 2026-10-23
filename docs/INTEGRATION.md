# Contract nối FE

Base URL local `http://localhost:4000`. Swagger `/docs` mô tả DTO đầu vào; response có thể tham khảo `test/api.test.ts` và bảng dưới. UUID là ID API; `legacyId` giúp chuyển dữ liệu builder cũ. Không dùng tên/slug hiển thị làm khóa order.

## Endpoint

| Quyền | Method + path | Dùng cho |
| --- | --- | --- |
| Public | GET `/v1/material-categories` | Rule single/multi, min/max, thứ tự step |
| Public | GET `/v1/materials?category=moss&limit=24&cursor=...` | Option, imageUrl, priceVnd nullable, unit, availability, revision |
| Public | GET `/v1/products`, GET `/v1/products/:slug` | Bể bán sẵn; chỉ published |
| Public | GET `/v1/portfolio` | Các bể đã làm; chỉ published |
| Public | GET `/v1/content/about`, GET `/v1/storefront` | Copy và liên hệ |
| Public | GET `/v1/pricing` | labourBps, depositBps, quantityMode, shippingMode, khu vực, configured |
| Public | POST `/v1/configurations/validate` | `{materialIds: [uuid,...]}`; không tạo đơn hay báo giá |
| Public | POST `/v1/auth/challenge`, POST `/v1/auth/google` | Google login |
| Customer/admin | GET `/v1/auth/me`, POST `/v1/auth/logout` | Session/profile/logout |
| Customer/admin | POST `/v1/quotes` | Báo giá riêng theo user, hạn 15 phút |
| Customer/admin | POST `/v1/orders` | Chốt quote, snapshot phiếu đơn trong một transaction |
| Customer/admin | GET `/v1/orders`, GET `/v1/orders/:id`, GET `/v1/orders/:id/invoice` | Chỉ đơn thuộc user đang đăng nhập |
| Admin | GET/POST `/v1/admin/materials`, PATCH `/v1/admin/materials/:id` | Vật liệu, giá, unit, publish, availability |
| Admin | GET/POST `/v1/admin/products`, PATCH `/v1/admin/products/:id` | Sản phẩm |
| Admin | GET/POST `/v1/admin/portfolio`, PATCH `/v1/admin/portfolio/:id` | Dự án đã làm |
| Admin | PATCH `/v1/admin/content/about`, PATCH `/v1/admin/storefront` | Nội dung có DTO giới hạn |
| Admin | GET/PATCH `/v1/admin/pricing` | Chính sách giá; PATCH yêu cầu If-Match |
| Admin | GET `/v1/admin/orders`, GET `/v1/admin/orders/:id`, GET `/v1/admin/orders/:id/invoice` | Xử lý đơn toàn shop |
| Admin | POST `/v1/admin/orders/:id/payments` | `{amountVnd, reference}` xác nhận tiền hàng |
| Admin | PATCH `/v1/admin/orders/:id/status` | `{status}` theo state machine |

List catalog/orders trả `{items,nextCursor}`; cursor opaque, không phân tích hoặc tự dựng trên FE. Category list không phân trang vì ít bước. Admin content chỉ patch các key cho phép, không nhận JSON tùy ý. Category đang là cấu hình seed/rule DB, chưa có endpoint admin sửa rule.

## Google và session

1. `POST /v1/auth/challenge` trả `{challengeId,nonce,...}`; hết hạn sau 5 phút.
2. Google GIS khởi tạo bằng Web client ID và `nonce` vừa nhận.
3. Callback nhận credential ID token: `POST /v1/auth/google` với `{idToken,challengeId}`. Nonce dùng một lần; không gửi access token thay ID token.
4. Response có `accessToken`, `expiresAt`, `user`. Token này là session BE ngẫu nhiên, không phải Google token. Gửi `Authorization: Bearer <accessToken>` tới API private.
5. Khuyến nghị Next BFF giữ session bằng cookie Secure, HttpOnly, SameSite phù hợp, chỉ server FE chuyển tiếp bearer. Đừng đưa token vào localStorage/log/URL; BFF mutation cần kiểm tra Origin/CSRF. Chưa viết phần BFF/Google UI trong FE.
6. Logout gọi BE rồi xóa cookie FE. Mỗi request đọc role/active từ DB nên thu hồi role/tắt tài khoản có tác dụng với session đang tồn tại.

Lỗi login không có `GOOGLE_CLIENT_ID`: 503; token/challenge sai: 401. Test dùng chữ ký RSA/JWKS local, chưa phải Google browser flow thực tế.

## Giá, quote và order

Cấu hình admin mẫu **chỉ sau khi shop xác nhận mỗi option là một phần cho một bể**:

```json
{
  "labourBps": 5000,
  "depositBps": 5000,
  "quantityMode": "per_selection",
  "shippingMode": "separate",
  "deliveryAreaCodes": ["HCM"]
}
```

`PATCH /v1/admin/pricing`, header `If-Match: <revision hiện tại>`. Material phải có `priceVnd`, `unit`, `availability: "available"`. `quantity` mode hỗ trợ đơn vị shop đã nhập, không tự quy đổi gram hay định mức theo bể.

Custom quote:

```json
{
  "kind": "custom",
  "items": [
    {"materialId": "uuid-be-kinh", "quantity": 1},
    {"materialId": "uuid-reu", "quantity": 1}
  ]
}
```

Bể sẵn: `{ "kind": "product", "productId": "uuid", "quantity": 1 }`. Không gửi `totalVnd`/`priceVnd` từ FE. Server tính tất cả, rêu tối đa 3 loại dù request được gọi ngoài UI.

Ví dụ nguyên liệu 130.000đ → công 65.000đ → tiền hàng 195.000đ → cọc 97.500đ. Với số lẻ, công `ceil(subtotal × 5000 / 10000)` và cọc `ceil(total × 5000 / 10000)`. Giá bể có sẵn không cộng công lần nữa. `shippingFeeVnd: null` phải hiển thị “chưa gồm phí giao hàng, shop xác nhận riêng”; không cộng null thành 0 rồi ghi “tổng thanh toán đã gồm ship”.

Tạo đơn với UUID idempotency key mới cho một lần checkout, giữ cùng key khi retry cùng payload:

```http
POST /v1/orders
Authorization: Bearer <session>
Idempotency-Key: <random UUID>
Content-Type: application/json
```

```json
{
  "quoteId": "uuid-quote",
  "recipientName": "Nguyễn An",
  "phone": "0900000000",
  "fulfillment": "delivery",
  "deliveryAreaCode": "HCM",
  "address": "Địa chỉ giao trong TP.HCM",
  "note": "Giao buổi chiều"
}
```

`fulfillment: "pickup"` không cần address/area. Một quote chỉ tạo một order. Retry cùng key khác payload bị 409; giá/policy/catalog đổi sau quote thì 409 và FE phải lấy quote mới, cho khách xem lại. Hết hạn quote: 409. Invoice lưu snapshot không bị thay đổi khi admin đổi tên/giá, thông tin trạng thái/paid hiện tại nằm ngoài snapshot.

Thanh toán thủ công: admin xác minh giao dịch ngân hàng ngoài hệ thống trước khi ghi `{amountVnd,reference}`. Reference nên gồm ngân hàng và mã giao dịch; toàn hệ thống không được ghi hai lần. API không chứng minh giao dịch ngân hàng đã xảy ra, không nhận thông báo từ khách làm bằng chứng.

Trạng thái: `awaiting_payment → confirmed` khi đủ cọc; `confirmed → building → ready → shipping → completed`. Nhận tại shop có thể `ready → completed`; completed cần đủ tiền hàng. Đơn chưa thu tiền có thể hủy; đơn đã có tiền chặn hủy cho đến khi bổ sung refund flow. Phí ship chưa thuộc ledger tiền hàng này.

## Lỗi, cache và đồng thời

Lỗi trả `{statusCode,code,message,requestId}`; không lộ SQL/credentials/stack. 400 input hoặc field lạ; 401 session/token; 403 role; 404 tài nguyên không tồn tại hoặc không thuộc owner; 409 revision/idempotency/stale quote; 422 rule/giá vật liệu chưa hợp lệ; 503 cấu hình chưa đủ hoặc readiness DB. FE cần hiển thị lỗi/lấy lại dữ liệu, không tự giả định tạo đơn thành công khi request timeout.

Admin patch catalog/content/pricing phải gửi If-Match từ revision vừa đọc; 409 thì reload và cho người quản trị xem lại. Public catalog có thể chậm tối đa cache TTL; giá checkout luôn kiểm tra DB. Auth/orders no-store; FE cũng dùng no-store cho dữ liệu tài khoản và không đưa vào cache dùng chung.

Ảnh BE trả URL, không host file. Nếu dùng Next Image với hostname CDN mới phải cấu hình remotePatterns trong FE trước. Không biến toàn landing thành Client Component chỉ để fetch catalog; giữ static/content fetching ở Server Components, tương tác builder/Google/checkout tách ở client phù hợp.


## Guest design inquiries (21/10/2026)

Luồng tư vấn option 1: khách không cần Google, chưa cần giá đầy đủ. Không thay đổi orders/quotes/payment ledger hiện có.

- `POST /v1/design-requests`: header `Authorization: Bearer <64 ký tự hex ngẫu nhiên>`, `Idempotency-Key: <UUID>`. Body `{materialIds,recipientName,phone,area,preferredDate?,note?}`; danh mục và giới hạn được validate lại bằng ConfigurationService dùng chung. Không nhận giá từ client. `phone`: số Việt Nam dạng 0 + 9 chữ số hoặc +84 + 9 chữ số. Snapshot tên vật liệu được lưu trên BE.
- Response `{id,number,status:'pending'}` chỉ trả sau commit. Cùng guest/key/payload trả cùng receipt; khác payload: 409. Retry receipt cũ vẫn lấy lại được nếu catalog đã đổi. Giới hạn cơ bản 5 yêu cầu/giờ/phiên; cần WAF/rate limit ở deployment.
- `GET /v1/design-requests/:id`: cùng bearer guest, chỉ trả receipt/selection/status, không trả contact. Guest khác: 404. Token chỉ lưu SHA-256 ở DB; BFF giữ token trong cookie HttpOnly; không đặt token trong URL/localStorage.
- `GET /v1/admin/design-requests?limit=24&cursor=...`: SessionGuard + AdminGuard, trả contact, snapshot, revision và cursor.
- `PATCH /v1/admin/design-requests/:id`: admin bearer + `If-Match`; body `{status:'pending'|'contacted'|'closed'}`; cập nhật có audit. Đây là trạng thái tiếp nhận tư vấn, không phải xác nhận cọc.

FE hiện có trang builder, receipt và quản lý yêu cầu. Google browser login và Postgres triển khai thật cần được smoke test theo môi trường. Giai đoạn này báo giá cuối cùng, phiếu xác nhận và nhận cọc vẫn trao đổi thủ công; chưa chuyển guest inquiry sang order tự động.
