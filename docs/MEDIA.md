# Ảnh, model và upload

## Vị trí dữ liệu

- `storage/assets/`: ảnh website và `terrarium-current.glb` chuyển nguyên file từ FE; BE phục vụ dưới `/assets/*`.
- `storage/assets/uploads/`: ảnh admin upload, được ignore Git/Docker build context. Mỗi file có UUID riêng, không ghi đè ảnh cũ.
- `storage/assets/.incoming/`: file tạm trước khi rename atomically; không phục vụ công khai.
- `reference/fe-docs/`: ảnh chụp kiểm thử/tài liệu của FE, giữ trong source BE nhưng không phục vụ HTTP.
- `docs/ASSET-MOVE-MANIFEST.json`: 51 file gốc, đường dẫn trước/sau, byte và SHA-256 để đối chiếu. GLB và ảnh gốc không bị nén hay sửa.

`MEDIA_STORAGE=local`, `MEDIA_ROOT=storage/assets` (tương đối với thư mục chạy BE). Khi dùng một volume trống, phải copy các asset gốc vào volume trước; nếu không, ảnh/model gốc sẽ không tồn tại trong mount đó.

FE Next rewrite `/assets/*` đến `TERRALA_ASSET_URL`, fallback `TERRALA_API_URL`, mặc định `http://127.0.0.1:4000`. Admin Rsbuild proxy cả `/assets` và `/v1` đến `ADMIN_API_PROXY_TARGET`. URL mới lưu trong DB là `/assets/...`; để `ASSET_BASE_URL` và `PUBLIC_ASSET_BASE_URL` trống khi dùng proxy cùng origin. Production cần cấu hình tương đương tại reverse proxy/hosting. Đổi env/config thì restart dev server.

Migration 012 chuyển URL ảnh cũ `http://localhost:3000/assets/...` và `http://127.0.0.1:3000/assets/...` trong các trường ảnh thành đường dẫn tương đối. Không thay host bên ngoài hoặc giá/tồn kho/publish.

## Luồng upload

Form vật liệu, sản phẩm, portfolio và About cho chọn file. Browser gửi `POST /v1/admin/media`, Bearer admin, `multipart/form-data`, field `file` duy nhất; không tự đặt Content-Type boundary.

- Chỉ active admin được upload; khách/không đăng nhập bị từ chối.
- PNG/JPEG/WebP tối đa 10 MiB; kiểm tra bytes thực, MIME và giải mã ảnh. Không nhận SVG, ảnh động, ảnh hỏng hoặc trên 40 megapixel/mỗi cạnh 12000px.
- Xử lý xoay theo EXIF, bỏ metadata, encode WebP lossless để giữ pixel/alpha sau giải mã. Output tối đa 20 MiB, tối đa hai ảnh được xử lý đồng thời mỗi process.
- Lưu file vào volume, sau đó transaction lưu metadata `media_assets` và audit `media.uploaded`. Nếu DB ghi thất bại, xóa file vừa tạo.
- Response `{id,url,mimeType,sizeBytes,width,height}`; URL `/assets/uploads/<uuid>.webp`.
- UI chỉ cập nhật đường dẫn khi upload thành công, giữ ảnh cũ nếu lỗi, khóa lưu form trong lúc upload. Sau đó nhấn Lưu để gắn ảnh vào nội dung qua API catalog/content hiện có.

Nút “Bỏ ảnh khỏi nội dung” chỉ bỏ tham chiếu, không xóa file vật lý. Ảnh upload rồi hủy form vẫn được giữ; hiện chưa có API xóa hoặc job dọn ảnh không dùng để tránh xóa nhầm ảnh dùng chung. Không upload tài liệu riêng tư: ảnh trong `/assets` là công khai. Ảnh docs nằm ngoài root này.

## Chạy với volume local

Chạy từ `terrarila-be`, sau khi cài dependency và tạo `.env`:

```sh
docker compose up -d postgres
npm run db:migrate
# Chỉ seed nếu cần khởi tạo catalog, không cần seed lại để chuyển ảnh.
# Dừng BE npm run dev trên port 4000 trước khi bật container backend:
docker compose -f compose.yaml -f compose.app.yaml up -d --build backend
```

`compose.app.yaml` mount `./storage/assets:/app/storage/assets`; upload còn nguyên khi recreate container. Đây là cấu hình local với Postgres local, không phải cấu hình HTTPS/TLS production. Có thể tiếp tục `npm run dev` trên host thay container; vẫn lưu cùng folder này.

Backup **cả PostgreSQL và toàn bộ MEDIA_ROOT**, gồm uploads. Không dùng Git thay backup file người dùng. Khôi phục cả hai cùng thời điểm để tránh mất file hoặc URL trỏ vào file không tồn tại. Đặt quota/giám sát dung lượng volume khi triển khai thật.

## Sau này dùng Vercel/object storage

Adapter hiện tại chỉ có `LocalAssetStorage` qua interface `AssetStorage`. Chưa có S3/Blob adapter và chưa deploy Vercel. Khi chuyển: bổ sung adapter, metadata provider/migration phù hợp, chuyển file gốc và upload, giữ mapping URL `/assets` qua proxy/CDN hoặc migrate URL có kiểm tra. Cấu hình hiện tại từ chối chạy khi có `VERCEL` để không nhận upload vào ổ tạm rồi mất dữ liệu.
