import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContentModule } from './content/content.module';
import { ContentAsset } from './content/content-asset.entity';
import { HealthController } from './common/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL || 'postgresql://campuscast:campuscast@localhost:5432/content_db',
      entities: [ContentAsset],
      synchronize: process.env.NODE_ENV === 'development',
    }),
    ContentModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
