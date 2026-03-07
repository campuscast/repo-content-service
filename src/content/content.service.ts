import { Injectable, NotFoundException, BadGatewayException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { ContentAsset } from './content-asset.entity';
import { StorageService } from '../storage/storage.service';
import { randomUUID } from 'crypto';
import { AuditClient } from '@campuscast/shared-libs';

@Injectable()
export class ContentService {
  private readonly signingKmsUrl = process.env.SIGNING_KMS_URL || 'http://localhost:3008';
  private readonly auditClient = new AuditClient();

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

    const signRes = await fetch(`${this.signingKmsUrl}/signing/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data_base64: Buffer.from(sha256Hash, 'utf8').toString('base64'),
        purpose: 'content',
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!signRes.ok) {
      const detail = await signRes.text();
      throw new BadGatewayException(`Signing-KMS sign failed: ${detail}`);
    }
    const signed = await signRes.json() as { signature: string; key_id: string; algorithm: string };
    if (signed.algorithm !== 'Ed25519') {
      throw new BadGatewayException(`Unsupported signing algorithm: ${signed.algorithm}`);
    }

    asset.sha256_hash = sha256Hash;
    asset.signature = signed.signature;
    asset.key_id = signed.key_id;
    asset.status = 'ready';
    const saved = await this.repo.save(asset);

    await this.auditClient.append({
      event_type: 'content.uploaded',
      actor_type: 'system',
      actor_id: 'content-service',
      zone_id: saved.zone_id,
      resource_type: 'asset',
      resource_id: saved.asset_id,
      action: 'uploaded',
      detail: {
        filename: saved.filename,
        sha256_hash: saved.sha256_hash,
      },
    });

    await this.auditClient.append({
      event_type: 'content.ready',
      actor_type: 'system',
      actor_id: 'content-service',
      zone_id: saved.zone_id,
      resource_type: 'asset',
      resource_id: saved.asset_id,
      action: 'ready',
      detail: {
        key_id: saved.key_id,
        signature: saved.signature,
      },
    });

    return saved;
  }

  async renameAsset(assetId: string, newFilename: string) {
    const asset = await this.repo.findOne({ where: { asset_id: assetId } });
    if (!asset) throw new NotFoundException('Asset not found');
    asset.filename = newFilename;
    return this.repo.save(asset);
  }

  async deleteAsset(assetId: string) {
    const asset = await this.repo.findOne({ where: { asset_id: assetId } });
    if (!asset) throw new NotFoundException('Asset not found');
    asset.status = 'deleted';
    return this.repo.save(asset);
  }

  async listByZone(zoneId: string, page: number, pageSize: number) {
    return this.repo.findAndCount({
      where: { zone_id: zoneId, status: Not('deleted') },
      skip: (page - 1) * pageSize,
      take: pageSize,
      order: { created_at: 'DESC' },
    });
  }
}
