import { Module } from '@nestjs/common';
import { MetricsModule } from '@campuscast/shared-libs';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContentModule } from './content/content.module';
import { ContentAsset } from './content/content-asset.entity';
import { HealthController } from './common/health.controller';
import { appConfig, dbConfig, s3Config, validate } from './config';

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
      entities: [ContentAsset],
      synchronize: process.env.NODE_ENV === 'development',
    }),
    ContentModule,
      MetricsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
