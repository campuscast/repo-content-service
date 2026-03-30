import { Module } from '@nestjs/common';
import { MetricsModule } from '@campuscast/shared-libs';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContentModule } from './content/content.module';
import { ContentAsset } from './content/content-asset.entity';
import { Publication } from './content/publication.entity';
import { Init1700000000000 } from './migrations/1700000000000-Init';
import { Publications1700000000001 } from './migrations/1700000000001-Publications';
import { ContentAssetZoneAvailability1700000000002 } from './migrations/1700000000002-ContentAssetZoneAvailability';
import { HealthController } from './common/health.controller';
import { appConfig, dbConfig, s3Config, validate } from './config';

const dbSynchronize = process.env.DB_SYNCHRONIZE === 'true';
const dbMigrationsRun = process.env.DB_MIGRATIONS_RUN !== 'false';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, dbConfig, s3Config],
      validate,
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL || 'postgresql://campuscast:campuscast@localhost:5432/content_db',
      entities: [ContentAsset, Publication],
      migrations: [Init1700000000000, Publications1700000000001, ContentAssetZoneAvailability1700000000002],
      migrationsRun: dbMigrationsRun,
      synchronize: dbSynchronize,
      logging: process.env.NODE_ENV === 'development',
    }),
    ContentModule,
      MetricsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
