import { Injectable, NotFoundException, BadGatewayException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { ContentAsset } from './content-asset.entity';
import { Publication } from './publication.entity';
import { StorageService } from '../storage/storage.service';
import { randomUUID } from 'crypto';
import { AuditClient } from '@campuscast/shared-libs';

@Injectable()
export class ContentService {
  private readonly signingKmsUrl = process.env.SIGNING_KMS_URL || 'http://localhost:3008';
  private readonly auditClient = new AuditClient();

  constructor(
    @InjectRepository(ContentAsset) private repo: Repository<ContentAsset>,
    @InjectRepository(Publication) private publicationRepo: Repository<Publication>,
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

  async getById(assetId: string) {
    const asset = await this.repo.findOne({ where: { asset_id: assetId } });
    if (!asset) throw new NotFoundException('Asset not found');
    return asset;
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

  async createPublication(data: {
    zone_id: string;
    title: string;
    type?: string;
    items?: Array<Record<string, unknown>>;
    metadata?: Record<string, unknown>;
    status?: string;
  }) {
    const zoneId = String(data.zone_id || '').trim();
    const title = String(data.title || '').trim();
    if (!zoneId) throw new BadRequestException('zone_id is required');
    if (!title) throw new BadRequestException('title is required');

    const publication = this.publicationRepo.create({
      zone_id: zoneId,
      title,
      type: String(data.type || 'slideshow'),
      status: String(data.status || 'draft'),
      version: 1,
      items: Array.isArray(data.items) ? data.items : [],
      metadata: data.metadata || {},
    });
    const saved = await this.publicationRepo.save(publication);

    await this.auditClient.append({
      event_type: 'publication.created',
      actor_type: 'system',
      actor_id: 'content-service',
      zone_id: saved.zone_id,
      resource_type: 'publication',
      resource_id: saved.publication_id,
      action: 'create',
      detail: { title: saved.title, type: saved.type },
    });

    return this.toPublicationDto(saved);
  }

  async listPublications(zoneId: string, page: number, pageSize: number, status?: string) {
    const where = status
      ? { zone_id: zoneId, status }
      : { zone_id: zoneId, status: Not('archived') };
    const [data, total] = await this.publicationRepo.findAndCount({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      order: { updated_at: 'DESC' },
    });
    return {
      data: data.map((item) => this.toPublicationDto(item)),
      pagination: { total, page, page_size: pageSize },
    };
  }

  async getPublication(publicationId: string) {
    const publication = await this.publicationRepo.findOne({
      where: { publication_id: publicationId },
    });
    if (!publication) throw new NotFoundException('Publication not found');
    return this.toPublicationDto(publication);
  }

  async updatePublication(
    publicationId: string,
    data: {
      title?: string;
      type?: string;
      status?: string;
      items?: Array<Record<string, unknown>>;
      metadata?: Record<string, unknown>;
    },
  ) {
    const publication = await this.publicationRepo.findOne({
      where: { publication_id: publicationId },
    });
    if (!publication) throw new NotFoundException('Publication not found');

    let changed = false;

    if (data.title !== undefined) {
      const title = String(data.title || '').trim();
      if (!title) throw new BadRequestException('title must be non-empty');
      publication.title = title;
      changed = true;
    }
    if (data.type !== undefined) {
      publication.type = String(data.type || 'slideshow');
      changed = true;
    }
    if (data.status !== undefined) {
      publication.status = String(data.status || 'draft');
      changed = true;
    }
    if (data.items !== undefined) {
      publication.items = Array.isArray(data.items) ? data.items : [];
      changed = true;
    }
    if (data.metadata !== undefined) {
      publication.metadata = data.metadata || {};
      changed = true;
    }

    if (changed) {
      publication.version = (publication.version || 1) + 1;
      await this.publicationRepo.save(publication);
      await this.auditClient.append({
        event_type: 'publication.updated',
        actor_type: 'system',
        actor_id: 'content-service',
        zone_id: publication.zone_id,
        resource_type: 'publication',
        resource_id: publication.publication_id,
        action: 'update',
        detail: { title: publication.title, type: publication.type, status: publication.status },
      });
    }

    return this.toPublicationDto(publication);
  }

  async deletePublication(publicationId: string) {
    const publication = await this.publicationRepo.findOne({
      where: { publication_id: publicationId },
    });
    if (!publication) throw new NotFoundException('Publication not found');
    if (publication.status === 'archived') {
      return this.toPublicationDto(publication);
    }

    publication.status = 'archived';
    publication.version = (publication.version || 1) + 1;
    await this.publicationRepo.save(publication);

    await this.auditClient.append({
      event_type: 'publication.archived',
      actor_type: 'system',
      actor_id: 'content-service',
      zone_id: publication.zone_id,
      resource_type: 'publication',
      resource_id: publication.publication_id,
      action: 'archive',
    });

    return this.toPublicationDto(publication);
  }

  async resolveAssets(zoneId: string, assetIds: string[]) {
    const uniqueAssetIds = Array.from(new Set(assetIds.filter(Boolean)));
    if (uniqueAssetIds.length === 0) {
      return { assets: [], missing_asset_ids: [] };
    }

    const rows = await this.repo.find({
      where: {
        zone_id: zoneId,
        status: 'ready',
        asset_id: In(uniqueAssetIds),
      },
    });

    const byId = new Map(rows.map((asset) => [asset.asset_id, asset]));
    const missingAssetIds: string[] = [];

    const resolved = await Promise.all(
      uniqueAssetIds.map(async (assetId) => {
        const asset = byId.get(assetId);
        if (!asset || !asset.storage_key) {
          missingAssetIds.push(assetId);
          return null;
        }

        const downloadUrl = await this.storage.getPresignedDownloadUrl(asset.storage_key);
        return {
          asset_id: asset.asset_id,
          filename: asset.filename,
          content_type: asset.content_type,
          file_size: Number(asset.file_size) || 0,
          sha256_hash: asset.sha256_hash,
          download_url: downloadUrl,
          metadata: asset.metadata || {},
        };
      }),
    );

    return {
      assets: resolved.filter((asset): asset is NonNullable<typeof asset> => Boolean(asset)),
      missing_asset_ids: missingAssetIds,
    };
  }

  async resolveManifestDependencies(body: {
    zone_id: string;
    asset_ids?: string[];
    publication_ids?: string[];
  }) {
    const zoneId = String(body.zone_id || '').trim();
    if (!zoneId) throw new BadRequestException('zone_id is required');

    const directAssetIds = Array.from(new Set((body.asset_ids || []).filter(Boolean)));
    const publicationIds = Array.from(new Set((body.publication_ids || []).filter(Boolean)));

    const missingPublicationIds: string[] = [];
    let publications: Publication[] = [];

    if (publicationIds.length > 0) {
      publications = await this.publicationRepo.find({
        where: {
          zone_id: zoneId,
          publication_id: In(publicationIds),
          status: Not('archived'),
        },
      });
      const byId = new Set(publications.map((item) => item.publication_id));
      for (const publicationId of publicationIds) {
        if (!byId.has(publicationId)) {
          missingPublicationIds.push(publicationId);
        }
      }
    }

    const derivedAssetIds = new Set<string>();
    for (const publication of publications) {
      this.collectAssetRefs(publication.items || [], derivedAssetIds);
    }

    const allAssetIds = Array.from(new Set([...directAssetIds, ...derivedAssetIds]));
    const resolved = await this.resolveAssets(zoneId, allAssetIds);

    return {
      assets: resolved.assets,
      missing_asset_ids: resolved.missing_asset_ids,
      publications: publications.map((item) => this.toPublicationDto(item)),
      missing_publication_ids: missingPublicationIds,
    };
  }

  private collectAssetRefs(value: unknown, output: Set<string>) {
    if (Array.isArray(value)) {
      for (const item of value) {
        this.collectAssetRefs(item, output);
      }
      return;
    }
    if (!value || typeof value !== 'object') return;

    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if ((key === 'asset_id' || key.endsWith('_asset_id')) && typeof raw === 'string' && raw.trim()) {
        output.add(raw.trim());
      }
      this.collectAssetRefs(raw, output);
    }
  }

  private toPublicationDto(publication: Publication) {
    return {
      publication_id: publication.publication_id,
      zone_id: publication.zone_id,
      title: publication.title,
      type: publication.type,
      status: publication.status,
      version: publication.version || 1,
      items: Array.isArray(publication.items) ? publication.items : [],
      metadata: publication.metadata || {},
      created_at: publication.created_at?.toISOString?.() || null,
      updated_at: publication.updated_at?.toISOString?.() || null,
    };
  }
}
