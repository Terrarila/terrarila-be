import { Operations } from './common/operations.js';
import { OperationsController } from './admin/operations.controller.js';
import { AuditController } from './admin/audit.controller.js';
import { AuditService } from './admin/audit.service.js';
import { ConfigurationService } from './configuration/configuration.service.js';
import { MediaMaintenanceController } from './media/media-maintenance.controller.js';
import { MediaController } from './media/media.controller.js';
import { MediaService } from './media/media.service.js';
import { BlobAssetStorage } from './media/blob-storage.js';
import { UploadIntentsService } from './media/upload-intents.service.js';
import { BLOB_UPLOAD_STORE, VercelBlobUploadStore } from './media/blob-upload-store.js';
import { ASSET_STORAGE, LocalAssetStorage } from './media/asset-storage.js';
import { DesignRequestsService } from './requests/requests.service.js';
import {
  DesignRequestsController,
  AdminDesignRequestsController,
} from './requests/requests.controller.js';
import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.service.js';
import { CatalogRepository } from './catalog/catalog.repository.js';
import { CatalogController } from './catalog/catalog.controller.js';
import { ConfigurationController } from './configuration/configuration.controller.js';
import { HealthController } from './health/health.controller.js';
import { AdminCatalogController } from './admin/catalog-admin.controller.js';
import { CatalogAdminService } from './admin/catalog-admin.service.js';
import { AdminMaterialsController } from './admin/admin.controller.js';
import { AdminGuard } from './admin/admin.guard.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { SessionGuard } from './auth/session.guard.js';
import { GOOGLE_VERIFY, createGoogleVerifier } from './auth/google.js';
import {
  OrdersController,
  AdminOrdersController,
  PublicPricingController,
} from './orders/orders.controller.js';
import { OrdersService } from './orders/orders.service.js';
import { CONFIG } from './common/config.js';
import type { AppConfig } from './common/config.js';

@Module({
  imports: [DatabaseModule],
  controllers: [
    OperationsController,
    AuditController,
    MediaController,
    MediaMaintenanceController,
    DesignRequestsController,
    AdminDesignRequestsController,
    CatalogController,
    ConfigurationController,
    HealthController,
    AdminMaterialsController,
    AdminCatalogController,
    AuthController,
    OrdersController,
    AdminOrdersController,
    PublicPricingController,
  ],
  providers: [
    Operations,
    AuditService,
    MediaService,
    UploadIntentsService,
    LocalAssetStorage,
    BlobAssetStorage,
    { provide: BLOB_UPLOAD_STORE, useClass: VercelBlobUploadStore },
    {
      provide: ASSET_STORAGE,
      inject: [CONFIG, LocalAssetStorage, BlobAssetStorage],
      useFactory: (config: AppConfig, local: LocalAssetStorage, blob: BlobAssetStorage) =>
        config.mediaStorage === 'vercel-blob' ? blob : local,
    },
    ConfigurationService,
    DesignRequestsService,
    CatalogAdminService,
    CatalogRepository,
    AdminGuard,
    AuthService,
    SessionGuard,
    OrdersService,
    {
      provide: GOOGLE_VERIFY,
      inject: [CONFIG],
      useFactory: (config: AppConfig) => createGoogleVerifier(config),
    },
  ],
})
export class AppModule {}
