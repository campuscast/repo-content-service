import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContentAsset } from './content-asset.entity';
import { StorageService } from '../storage/storage.service';
import { randomUUID } from 'crypto';

@Injectable()
export class ContentService {
  constructor(
    @InjectRepository(ContentAsset) private repo: Repository<ContentAsset>,
    private storage: StorageService,
  ) {}

  async initUpload(data: { zone_id: string; filename: string; content_type: string; file_size: number; metadata?: Record<string, string> }) {
    const storageKey = `${data.zone_id}/${randomUUID()}/${data.filename}`;
    const asset = this.repo.create({ ...data, storage_key: storageKey, status: 'uploading' });
    const saved = await this.repo.save(asset);
    const uploadUrl = await this.storage.getPresignedUploadUrl(storageKey, data.content_type);
    return { asset_id: saved.asset_id, upload_url: uploadUrl, expires_at: new Date(Date.now() + 3600_000) };
  }

  async completeUpload(assetId: string, sha256Hash: string) {
    const asset = await this.repo.findOne({ where: { asset_id: assetId } });
    if (!asset) throw new NotFoundException('Asset not found');

    // TODO: call signing-kms to sign hash
    const signature = 'stub-signature-base64';
    const keyId = 'dev-key-1';

    asset.sha256_hash = sha256Hash;
    asset.signature = signature;
    asset.key_id = keyId;
    asset.status = 'ready';
    return this.repo.save(asset);
  }

  async listByZone(zoneId: string, page: number, pageSize: number) {
    return this.repo.findAndCount({
      where: { zone_id: zoneId, status: 'ready' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      order: { created_at: 'DESC' },
    });
  }
}
