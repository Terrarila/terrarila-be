# FE đang cần gì từ BE?

> Cập nhật 21/10/2026: đây là bản audit trước khi nối FE. Luồng guest inquiry, Redux Persist, receipt và quản trị tiếp nhận hiện đã có; xem [REQUEST-INTEGRATION.md](../../terrarila-fe/docs/REQUEST-INTEGRATION.md) và phần Guest design inquiries trong INTEGRATION.md. Các mục checkout, phiếu xác nhận/cọc và triển khai thật vẫn cần đối chiếu riêng.

Đã đọc source FE hiện tại tại `terrarila-fe/src`, đặc biệt `components/landing/landing-sections.tsx`, `components/custom-terrarium/material-catalog.ts` và builder. Đây là audit source, không suy ra quy trình kinh doanh từ nội dung demo.

## Hiện trạng và API đã chuẩn bị

| Chức năng FE | Hiện trạng | BE cung cấp |
| --- | --- | --- |
| Bể có sẵn | Ba sản phẩm hardcode, giá hiển thị chưa được xác nhận | Products list/detail, giá, ảnh, availability, publish |
| Những bể đã làm | Nội dung/ảnh tĩnh | Portfolio riêng với sản phẩm bán |
| About và liên hệ/footer | Copy tĩnh | About và storefront có admin chỉnh sửa |
| Custom builder | Năm category, option ảnh local, ghi chú, reset/copy | Categories, materials, giá/đơn vị từng option, validate lựa chọn |
| Chọn vật liệu | Glass 2, gravel 2, soil 2, moss 7, plants 7 | Seed 20 option đúng legacy ID; 18 đường dẫn ảnh, đất chưa có ảnh |
| Giới hạn chọn | Một kính, rêu tối đa ba | Kiểm tra lại ở BE; chọn hai loại sỏi được phép |
| Đặt đơn/cọc | Chưa có checkout API | Quote có hạn 15 phút, order idempotent, phiếu đơn bất biến |
| Tài khoản | Chưa nối Google | Google ID token, session BE, hồ sơ và lịch sử đơn theo owner |
| Quản trị | Chưa có admin UI | API riêng phân quyền admin, revision, audit, xác nhận thanh toán |

FE vẫn giữ nguyên trong lần này. API không tự thay hardcode hoặc tạo UI admin/đăng nhập/checkout. GLB và hero không liên quan BE, giữ ở FE/static hosting; không đưa 35 MB GLB qua NestJS.

## Quyết định kiến trúc

PostgreSQL phù hợp vì order, quote, material, payment có quan hệ và cần transaction, khóa chống retry, số tiền chính xác, lịch sử không bị đổi khi catalog thay đổi. MongoDB vẫn có thể làm nhưng không mang lợi thế rõ cho luồng hiện tại. Không thêm Redis, queue, ORM hoặc microservices khi chưa có nhu cầu vận hành cụ thể; SQL parameterized nằm ở repository/service giới hạn theo domain.

Một Nest app với các thư mục domain, một pool/instance. SQL migration có checksum, seed idempotent. Danh sách phân trang cursor tối đa 100; index cho nội dung public và lịch sử đơn. Public catalog cache CDN ngắn 60 giây; auth/quote/order no-store và kiểm tra giá từ DB, không tin giá FE hay cache. Material/product có revision; cập nhật đồng thời yêu cầu If-Match, quote cũ bị từ chối khi giá/policy/availability thay đổi.

Giá nguyên liệu/đơn vị chưa xác nhận để null và inquiry, không dựng bảng giá giả. Ba sản phẩm demo seed ở draft, không đưa giá FE thành giá bán thật. Portfolio không tự tạo các dự án không có dữ liệu. Ảnh/model đã chuyển sang `storage/assets` của BE; metadata upload nằm trong `media_assets`. FE/admin proxy `/assets` đến BE; xem [MEDIA.md](MEDIA.md).

## Những phần cần chốt hoặc bổ sung trước khi bán thật

1. **Bảng giá và đơn vị:** mỗi option là một phần cho bể, theo chậu/gram hay số lượng? Bể ngang và bể vuông có cần định mức đất/rêu khác nhau? Chưa bật quantity mode cho đến khi shop nhập đúng. Công 50% và cọc 50% đã xác nhận, không cần hỏi lại.
2. **Tồn kho:** hiện có available/unavailable/inquiry, chưa có số lượng kho và giữ hàng. Bể độc bản cần reservation có hạn và chống hai khách mua cùng sản phẩm trước khi mở bán; khóa order hiện tại chỉ chống gửi trùng, không giải quyết tồn kho.
3. **Quy tắc bể hợp lệ:** hiện tối thiểu chỉ cần một bể kính theo builder. Shop cần quyết định bắt buộc đất/sỏi/rêu không, vật liệu nào không tương thích và giới hạn theo kích thước. Không tự đặt quy tắc sinh học từ tên cây.
4. **Chuyển khoản:** cần ngân hàng, số tài khoản, tên chủ tài khoản, nội dung chuyển, hạn cọc, xử lý hết hạn. API hiện admin ghi nhận mã giao dịch duy nhất; chưa OCR biên lai, QR, webhook ngân hàng hay tự đối soát.
5. **Ship:** đã giới hạn HCM và nhận shop; phí chưa gồm trong tiền hàng/cọc. Cần luồng báo phí và khách đồng ý, thời gian giao, địa chỉ shop, lịch nhận. Hiện phí được thống nhất ngoài web, BE chưa ghi nhận phụ phí ship hay thanh toán phí ship trong sổ tiền hàng.
6. **Hủy/hoàn tiền:** đơn đã nhận tiền bị chặn hủy để tránh mất dấu tiền. Cần chính sách hoàn cọc, ghi nhận refund, ai duyệt và xử lý hàng đang làm. Chưa có refund API.
7. **Thông báo:** email xác nhận/cọc/trạng thái, hướng dẫn chăm cây, báo đơn cho shop chưa có provider/job. API hoàn thành không đồng nghĩa khách đã nhận thông báo.
8. **Ảnh và nội dung:** admin đã chọn file và upload vào filesystem BE có volume; đã kiểm tra định dạng/kích thước/quyền admin. Object storage/CDN để triển khai sau. Cần ảnh sản phẩm thật và nội dung storefront (Zalo/Messenger/địa chỉ/giờ mở cửa). Upload endpoint: `POST /v1/admin/media`.
9. **Customer/admin UI:** Google login và BFF cookie, account/orders, form giao nhận, invoice view, admin quản lý catalog/pricing/order là bước FE tiếp theo. Username hiện là tên hiển thị Google, không phải handle duy nhất; chỉnh profile/address book/chia sẻ cấu hình lưu lâu chưa triển khai.
10. **Vận hành:** tài khoản DB/Google/Vercel thật, backup và restore thử, WAF/rate limit, giám sát, lưu trữ/xóa thông tin khách theo chính sách của shop. Cần smoke test deployed thật trước nhận thanh toán.

Chưa triển khai giỏ nhiều sản phẩm trong một đơn, mã giảm giá, tìm kiếm nâng cao, variant kích thước, review, dashboard số liệu, hóa đơn VAT hay PDF. Những phần này không được suy ra là bắt buộc từ landing hiện tại; bổ sung khi có luồng nghiệp vụ rõ.
