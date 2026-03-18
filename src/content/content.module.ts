import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContentAsset } from './content-asset.entity';
import { Publication } from './publication.entity';
import { ContentService } from './content.service';
import { ContentController } from './content.controller';
import { StorageService } from '../storage/storage.service';

@Module({
  imports: [TypeOrmModule.forFeature([ContentAsset, Publication])],
  providers: [ContentService, StorageService],
  controllers: [ContentController],
  exports: [ContentService],
})
export class ContentModule {}
