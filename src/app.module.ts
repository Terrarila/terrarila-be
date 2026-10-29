import { ConfigurationService } from './configuration/configuration.service.js';
import { MediaController } from './media/media.controller.js';
import { MediaService } from './media/media.service.js';
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
    MediaController,
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
    MediaService,
    { provide: ASSET_STORAGE, useClass: LocalAssetStorage },
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
