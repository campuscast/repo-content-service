import { Controller, Post, Get, Param, Body, Query } from '@nestjs/common';
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

  @Get()
  async list(@Query('zone_id') zoneId: string, @Query('page') page = 1, @Query('page_size') pageSize = 20) {
    const [data, total] = await this.svc.listByZone(zoneId, +page, +pageSize);
    return { data, pagination: { total, page: +page, page_size: +pageSize } };
  }
}
