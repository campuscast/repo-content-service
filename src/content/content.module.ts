import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContentAsset } from './content-asset.entity';
import { ContentService } from './content.service';
import { ContentController } from './content.controller';
import { StorageService } from '../storage/storage.service';

@Module({
  imports: [TypeOrmModule.forFeature([ContentAsset])],
  providers: [ContentService, StorageService],
  controllers: [ContentController],
  exports: [ContentService],
})
export class ContentModule {}
