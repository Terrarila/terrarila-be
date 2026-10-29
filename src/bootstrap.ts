import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, static as serveStatic } from 'express';
import type { ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { ApiExceptionFilter, requestContext } from './common/http.js';
import type { AppConfig } from './common/config.js';

export async function configureApp(app: INestApplication, config: AppConfig) {
  app.use(requestContext);
  app.use(helmet());
  app.use(
    '/assets',
    serveStatic(config.mediaRoot, {
      dotfiles: 'deny',
      index: false,
      redirect: false,
      fallthrough: false,
      maxAge: '1d',
      setHeaders(response, filePath) {
        response.setHeader(
          'Cache-Control',
          filePath.includes('/uploads/')
            ? 'public, max-age=31536000, immutable'
            : 'public, max-age=3600',
        );
        response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        response.setHeader('Access-Control-Allow-Origin', '*');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      },
    }),
  );
  const assetError: ErrorRequestHandler = (
    error: { status?: number },
    _request,
    response,
    _next,
  ) => {
    const status = [400, 403, 404].includes(error.status ?? 0) ? error.status! : 500;
    response.status(status).json({
      statusCode: status,
      message: status === 404 ? 'Asset not found' : 'Asset unavailable',
    });
  };
  app.use('/assets', assetError);
  app.use(json({ limit: '32kb', strict: true }));
  app.enableCors({
    origin: config.corsOrigins,
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'If-Match',
      'X-Request-Id',
      'Idempotency-Key',
    ],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      validationError: { target: false, value: false },
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  if (config.swaggerEnabled) {
    const definition = new DocumentBuilder()
      .setTitle('Petite Terre · Backend Explorer')
      .setVersion('1.0')
      .setDescription(
        [
          config.environment === 'test'
            ? '**MÔI TRƯỜNG DEMO:** dữ liệu trong bộ nhớ, mất khi dừng server.\n'
            : '',
          '## Backend hiện có gì?',
          'Các nhóm chức năng:',
          '- **Catalog / Pricing:** Bể, cây, rêu, vật liệu và chính sách giá.',
          '- **Configuration:** Kiểm tra lựa chọn của khách.',
          '- **Design requests:** Nhận yêu cầu tư vấn không cần Google.',
          '- **Authentication:** Google login, admin email/mật khẩu, hồ sơ và phiên đăng nhập.',
          '- **Orders:** Báo giá, đơn hàng và phiếu tóm tắt đơn.',
          '- **Admin:** Quản lý danh mục, yêu cầu, đơn và ghi nhận tiền.',
          '## Cách xem và thử',
          '1. Mở một nhóm → bấm endpoint để xem Parameters, Request body và Responses.',
          '2. Bắt đầu với **GET /v1/material-categories**, **GET /v1/materials**, **GET /v1/pricing**. Bấm **Try it out → Execute** để xem JSON thực tế.',
          '3. API có biểu tượng khóa cần đúng loại token trong **Authorize**. Google ID token chỉ dùng ở /v1/auth/google; các API riêng dùng accessToken do backend trả.',
          '4. Guest request dùng khóa phiên khách riêng (guest), khác token đăng nhập. FE tự giữ khóa này bằng cookie HttpOnly.',
          '5. **GET /health/ready** kiểm tra kết nối database. Swagger mở được chưa có nghĩa database đã sẵn sàng.',
          'Giá null / inquiry là chưa xác nhận giá bán. Phiếu đơn ở đây là phiếu tóm tắt đơn hàng. Yêu cầu tư vấn pending/contacted/closed chưa phải đơn đã chốt hoặc đã nhận cọc.',
        ].join('\n\n'),
      )
      .addBearerAuth({
        type: 'http',
        scheme: 'bearer',
        description:
          'accessToken từ POST /v1/auth/google hoặc /v1/auth/admin/login. Admin cần role admin.',
      })
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          description:
            'Khóa phiên khách: 64 ký tự hex ngẫu nhiên. Không dùng Google token hoặc admin token.',
        },
        'guest',
      )
      .addTag('Health', 'Kiểm tra server đang chạy và database đã sẵn sàng.')
      .addTag('Admin', 'Cập nhật vật liệu; chỉ admin.')
      .addTag('Admin catalog', 'Quản lý bể, portfolio và nội dung shop; chỉ admin.')
      .addTag('Catalog', 'Danh mục vật liệu, bể có sẵn, portfolio và nội dung shop.')
      .addTag('Pricing', 'Chính sách giá; giá và đơn vị chưa đủ sẽ không tự tính báo giá.')
      .addTag('Configuration', 'Kiểm tra lựa chọn theo danh mục hiện tại, không tạo đơn.')
      .addTag(
        'Design requests',
        'Khách gửi yêu cầu tư vấn; chưa cần đăng nhập Google hoặc giá đầy đủ.',
      )
      .addTag(
        'Authentication',
        'Google / admin email-mật khẩu, phiên đăng nhập, hồ sơ và đăng xuất.',
      )
      .addTag('Orders', 'Báo giá và đơn đã chốt; cần đăng nhập.')
      .addTag(
        'Admin design requests',
        'Xem liên hệ khách và cập nhật trạng thái tiếp nhận; chỉ admin.',
      )
      .addTag(
        'Admin orders',
        'Chính sách giá, đơn hàng, trạng thái và xác nhận tiền thủ công; chỉ admin.',
      )
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, definition), {
      jsonDocumentUrl: 'openapi.json',
      customSiteTitle: 'Petite Terre · API Explorer',
      swaggerOptions: {
        docExpansion: 'none',
        filter: true,
        displayRequestDuration: true,
        defaultModelsExpandDepth: 1,
        persistAuthorization: false,
      },
    });
  }
  await app.init();
}
