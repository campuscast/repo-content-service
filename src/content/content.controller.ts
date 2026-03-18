import { Controller, Post, Get, Delete, Patch, Param, Body, Query } from '@nestjs/common';
import { ContentService } from './content.service';

@Controller('content')
export class ContentController {
  constructor(private svc: ContentService) {}

  @Post('init-upload')
  async initUpload(@Body() body: { zone_id: string; filename: string; content_type: string; file_size: number }) {
    return this.svc.initUpload(body);
  }

  @Post(':assetId/complete')
  async complete(@Param('assetId') id: string, @Body() body: { sha256_hash: string }) {
    return this.svc.completeUpload(id, body.sha256_hash);
  }

  @Get('asset/:assetId')
  async getById(@Param('assetId') id: string) {
    return this.svc.getById(id);
  }

  @Patch(':assetId')
  async rename(@Param('assetId') id: string, @Body() body: { filename: string }) {
    return this.svc.renameAsset(id, body.filename);
  }

  @Delete(':assetId')
  async delete(@Param('assetId') id: string) {
    return this.svc.deleteAsset(id);
  }

  @Get()
  async list(@Query('zone_id') zoneId: string, @Query('page') page = 1, @Query('page_size') pageSize = 20) {
    const [data, total] = await this.svc.listByZone(zoneId, +page, +pageSize);
    return { data, pagination: { total, page: +page, page_size: +pageSize } };
  }

  @Post('resolve-assets')
  async resolveAssets(@Body() body: { zone_id: string; asset_ids: string[] }) {
    return this.svc.resolveAssets(body.zone_id, body.asset_ids || []);
  }

  @Post('resolve-manifest-deps')
  async resolveManifestDeps(@Body() body: { zone_id: string; asset_ids?: string[]; publication_ids?: string[] }) {
    return this.svc.resolveManifestDependencies(body);
  }

  @Post('publications')
  async createPublication(
    @Body() body: {
      zone_id: string;
      title: string;
      type?: string;
      items?: Array<Record<string, unknown>>;
      metadata?: Record<string, unknown>;
      status?: string;
    },
  ) {
    return this.svc.createPublication(body);
  }

  @Get('publications')
  async listPublications(
    @Query('zone_id') zoneId: string,
    @Query('page') page = 1,
    @Query('page_size') pageSize = 20,
    @Query('status') status?: string,
  ) {
    return this.svc.listPublications(zoneId, +page, +pageSize, status);
  }

  @Get('publications/:publicationId')
  async getPublication(@Param('publicationId') publicationId: string) {
    return this.svc.getPublication(publicationId);
  }

  @Patch('publications/:publicationId')
  async updatePublication(
    @Param('publicationId') publicationId: string,
    @Body() body: {
      title?: string;
      type?: string;
      status?: string;
      items?: Array<Record<string, unknown>>;
      metadata?: Record<string, unknown>;
    },
  ) {
    return this.svc.updatePublication(publicationId, body);
  }

  @Delete('publications/:publicationId')
  async deletePublication(@Param('publicationId') publicationId: string) {
    return this.svc.deletePublication(publicationId);
  }
}
