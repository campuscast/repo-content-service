import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { AuditClient } from '@campuscast/shared-libs';
import { ContentAsset } from './content-asset.entity';
import { Publication } from './publication.entity';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class ContentService {
  private readonly signingKmsUrl = process.env.SIGNING_KMS_URL || 'http://localhost:3008';
  private readonly auditClient = new AuditClient();

  constructor(
    @InjectRepository(ContentAsset) private repo: Repository<ContentAsset>,
    @InjectRepository(Publication) private publicationRepo: Repository<Publication>,
    private storage: StorageService,
  ) {}

  async initUpload(data: {
    zone_id: string;
    filename: string;
    content_type: string;
    file_size: number;
    metadata?: Record<string, string>;
  }) {
    const zoneId = this.requireZoneId(data.zone_id);
    const storageKey = `${zoneId}/${randomUUID()}/${String(data.filename || '').trim()}`;
    const asset = this.repo.create({
      ...data,
      zone_id: zoneId,
      zone_ids: [zoneId],
      storage_key: storageKey,
      status: 'uploading',
    });
    const saved = await this.repo.save(asset);
    const uploadUrl = await this.storage.getPresignedUploadUrl(storageKey, data.content_type);
    return {
      asset_id: saved.asset_id,
      upload_url: uploadUrl,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    };
  }

  async completeUpload(assetId: string, sha256Hash: string) {
    const asset = await this.getAssetOrThrow(assetId);

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

    return this.toAssetDto(saved);
  }

  async renameAsset(assetId: string, newFilename: string) {
    const asset = await this.getAssetOrThrow(assetId);
    const filename = String(newFilename || '').trim();
    if (!filename) {
      throw new BadRequestException('filename must be non-empty');
    }
    asset.filename = filename;
    const saved = await this.repo.save(asset);
    return this.toAssetDto(saved);
  }

  async getById(assetId: string) {
    const asset = await this.getAssetOrThrow(assetId);
    return this.toAssetDto(asset);
  }

  async getAssetInfo(assetId: string) {
    const asset = await this.getAssetOrThrow(assetId);
    const zoneIds = this.normalizeZoneIds(asset.zone_ids, asset.status === 'deleted' ? '' : asset.zone_id);
    const publicationCounts = await this.getPublicationUsageCounts(asset.asset_id, zoneIds);

    return {
      asset: this.toAssetDto(asset),
      usage_by_zone: zoneIds.map((zoneId) => ({
        zone_id: zoneId,
        publication_count: publicationCounts.get(zoneId) || 0,
      })),
      unused_zone_ids: zoneIds.filter((zoneId) => (publicationCounts.get(zoneId) || 0) === 0),
    };
  }

  async updateAssetAvailability(assetId: string, zoneIds: string[]) {
    const asset = await this.getAssetOrThrow(assetId);
    if (asset.status === 'deleted') {
      throw new BadRequestException('Cannot update availability for a deleted asset');
    }

    const nextZoneIds = this.normalizeZoneIds(zoneIds);
    const currentZoneIds = this.normalizeZoneIds(asset.zone_ids, asset.zone_id);
    const publicationCounts = await this.getPublicationUsageCounts(asset.asset_id, currentZoneIds);
    const removedZoneIds = currentZoneIds.filter((zoneId) => !nextZoneIds.includes(zoneId));
    const blockedZoneIds = removedZoneIds.filter((zoneId) => (publicationCounts.get(zoneId) || 0) > 0);

    if (blockedZoneIds.length > 0) {
      throw new BadRequestException(`Cannot remove zones still used in publications: ${blockedZoneIds.join(', ')}`);
    }

    if (nextZoneIds.length === 0) {
      throw new BadRequestException(
        'Removing access from the last available zone would orphan this asset. Delete the asset explicitly if you want to remove it completely.',
      );
    }

    asset.zone_ids = nextZoneIds;
    const saved = await this.repo.save(asset);

    await this.auditClient.append({
      event_type: 'content.availability.updated',
      actor_type: 'system',
      actor_id: 'content-service',
      zone_id: saved.zone_id,
      resource_type: 'asset',
      resource_id: saved.asset_id,
      action: 'availability_updated',
      detail: {
        zone_ids: nextZoneIds,
      },
    });

    return this.getAssetInfo(assetId);
  }

  async pruneUnusedAvailability(assetId: string) {
    const info = await this.getAssetInfo(assetId);
    const usedZoneIds = info.usage_by_zone
      .filter((entry) => entry.publication_count > 0)
      .map((entry) => entry.zone_id);
    if (usedZoneIds.length === 0) {
      throw new BadRequestException(
        'Removing unused availability would leave this asset without any zones. Delete the asset explicitly if you want to remove it completely.',
      );
    }
    return this.updateAssetAvailability(assetId, usedZoneIds);
  }

  async deleteAsset(assetId: string) {
    const asset = await this.getAssetOrThrow(assetId);
    const zoneIds = this.normalizeZoneIds(asset.zone_ids, asset.zone_id);
    const publicationCounts = await this.getPublicationUsageCounts(asset.asset_id, zoneIds);
    const usedZoneIds = zoneIds.filter((zoneId) => (publicationCounts.get(zoneId) || 0) > 0);

    if (usedZoneIds.length > 0) {
      throw new BadRequestException(`Cannot delete asset used in publications: ${usedZoneIds.join(', ')}`);
    }

    try {
      await this.storage.deleteObject(asset.storage_key || '');
    } catch (error) {
      throw new BadGatewayException(
        `Failed to delete asset binary from storage: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
    await this.repo.remove(asset);

    await this.auditClient.append({
      event_type: 'content.deleted',
      actor_type: 'system',
      actor_id: 'content-service',
      zone_id: asset.zone_id,
      resource_type: 'asset',
      resource_id: asset.asset_id,
      action: 'delete',
      detail: {
        filename: asset.filename,
        storage_key: asset.storage_key || '',
      },
    });

    return {
      ...this.toAssetDto(asset),
      status: 'deleted',
      zone_ids: [],
    };
  }

  async listByZones(zoneIds: string[], page: number, pageSize: number) {
    const normalizedZoneIds = this.normalizeZoneIds(zoneIds);
    if (normalizedZoneIds.length === 0) {
      return [[], 0] as const;
    }

    const baseQuery = this.repo
      .createQueryBuilder('asset')
      .where('asset.status != :deleted', { deleted: 'deleted' })
      .andWhere('asset.zone_ids && ARRAY[:...zoneIds]::text[]', { zoneIds: normalizedZoneIds });

    const total = await baseQuery.getCount();
    const data = await baseQuery
      .clone()
      .orderBy('asset.created_at', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    return [data.map((asset) => this.toAssetDto(asset)), total] as const;
  }

  async createPublication(data: {
    zone_id: string;
    title: string;
    type?: string;
    items?: Array<Record<string, unknown>>;
    metadata?: Record<string, unknown>;
    status?: string;
  }) {
    const zoneId = this.requireZoneId(data.zone_id);
    const title = String(data.title || '').trim();
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

  async copyPublication(
    sourcePublicationId: string,
    data: {
      zone_id: string;
      title: string;
    },
  ) {
    const source = await this.publicationRepo.findOne({
      where: { publication_id: sourcePublicationId },
    });
    if (!source) throw new NotFoundException('Publication not found');

    const targetZoneId = this.requireZoneId(data.zone_id);
    const title = String(data.title || '').trim();
    if (!title) throw new BadRequestException('title is required');

    const assetIds = new Set<string>();
    this.collectAssetRefs(source.items || [], assetIds);
    await this.ensureAssetsAvailableInZone(Array.from(assetIds), targetZoneId);

    const created = await this.createPublication({
      zone_id: targetZoneId,
      title,
      type: source.type,
      status: 'draft',
      items: this.cloneJson(source.items || []),
      metadata: this.cloneJson(source.metadata || {}),
    });

    await this.auditClient.append({
      event_type: 'publication.copied',
      actor_type: 'system',
      actor_id: 'content-service',
      zone_id: targetZoneId,
      resource_type: 'publication',
      resource_id: created.publication_id,
      action: 'copy',
      detail: {
        source_publication_id: source.publication_id,
        source_zone_id: source.zone_id,
      },
    });

    return created;
  }

  async listPublications(zoneId: string, page: number, pageSize: number, status?: string) {
    const safeZoneId = this.requireZoneId(zoneId);
    const where = status
      ? { zone_id: safeZoneId, status }
      : { zone_id: safeZoneId, status: Not('archived') };
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
    const safeZoneId = this.requireZoneId(zoneId);
    const uniqueAssetIds = Array.from(new Set(assetIds.filter(Boolean)));
    if (uniqueAssetIds.length === 0) {
      return { assets: [], missing_asset_ids: [] };
    }

    const rows = await this.repo
      .createQueryBuilder('asset')
      .where('asset.status = :status', { status: 'ready' })
      .andWhere('asset.asset_id IN (:...assetIds)', { assetIds: uniqueAssetIds })
      .andWhere('asset.zone_ids && ARRAY[:...zoneIds]::text[]', { zoneIds: [safeZoneId] })
      .getMany();

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
          zone_ids: this.normalizeZoneIds(asset.zone_ids, asset.zone_id),
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
    const zoneId = this.requireZoneId(body.zone_id);
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

  private async getAssetOrThrow(assetId: string) {
    const asset = await this.repo.findOne({ where: { asset_id: assetId } });
    if (!asset) throw new NotFoundException('Asset not found');
    asset.zone_ids = this.normalizeZoneIds(asset.zone_ids, asset.status === 'deleted' ? '' : asset.zone_id);
    return asset;
  }

  private async ensureAssetsAvailableInZone(assetIds: string[], targetZoneId: string) {
    const uniqueAssetIds = Array.from(new Set(assetIds.filter(Boolean)));
    if (uniqueAssetIds.length === 0) return;

    const assets = await this.repo.find({
      where: {
        asset_id: In(uniqueAssetIds),
        status: Not('deleted'),
      },
    });
    const assetsById = new Map(assets.map((asset) => [asset.asset_id, asset]));
    const missingAssetIds = uniqueAssetIds.filter((assetId) => !assetsById.has(assetId));
    if (missingAssetIds.length > 0) {
      throw new BadRequestException(`Referenced assets not found: ${missingAssetIds.join(', ')}`);
    }

    const changedAssets = assets.filter((asset) => {
      const nextZoneIds = this.normalizeZoneIds(asset.zone_ids, asset.zone_id);
      if (nextZoneIds.includes(targetZoneId)) {
        asset.zone_ids = nextZoneIds;
        return false;
      }
      asset.zone_ids = [...nextZoneIds, targetZoneId];
      return true;
    });

    if (changedAssets.length > 0) {
      await this.repo.save(changedAssets);
      await Promise.all(
        changedAssets.map((asset) =>
          this.auditClient.append({
            event_type: 'content.availability.shared',
            actor_type: 'system',
            actor_id: 'content-service',
            zone_id: targetZoneId,
            resource_type: 'asset',
            resource_id: asset.asset_id,
            action: 'zone_shared',
            detail: {
              zone_ids: asset.zone_ids,
            },
          }),
        ),
      );
    }
  }

  private async getPublicationUsageCounts(assetId: string, zoneIds: string[]) {
    const normalizedZoneIds = this.normalizeZoneIds(zoneIds);
    const counts = new Map<string, number>();

    if (normalizedZoneIds.length === 0) {
      return counts;
    }

    const publications = await this.publicationRepo.find({
      where: {
        zone_id: In(normalizedZoneIds),
        status: Not('archived'),
      },
    });

    for (const publication of publications) {
      const refs = new Set<string>();
      this.collectAssetRefs(publication.items || [], refs);
      if (!refs.has(assetId)) {
        continue;
      }
      counts.set(publication.zone_id, (counts.get(publication.zone_id) || 0) + 1);
    }

    return counts;
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

  private normalizeZoneIds(zoneIds: unknown, fallbackZoneId?: string) {
    const normalized = Array.from(
      new Set(
        (Array.isArray(zoneIds) ? zoneIds : [])
          .map((zoneId) => String(zoneId || '').trim())
          .filter(Boolean),
      ),
    );

    if (normalized.length > 0) {
      return normalized;
    }

    const fallback = String(fallbackZoneId || '').trim();
    return fallback ? [fallback] : [];
  }

  private requireZoneId(zoneId: unknown) {
    const normalized = String(zoneId || '').trim();
    if (!normalized) {
      throw new BadRequestException('zone_id is required');
    }
    return normalized;
  }

  private cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  private toAssetDto(asset: ContentAsset) {
    return {
      asset_id: asset.asset_id,
      zone_id: asset.zone_id,
      zone_ids: this.normalizeZoneIds(asset.zone_ids, asset.status === 'deleted' ? '' : asset.zone_id),
      filename: asset.filename,
      content_type: asset.content_type,
      file_size: Number(asset.file_size) || 0,
      sha256_hash: asset.sha256_hash || '',
      storage_key: asset.storage_key || '',
      status: asset.status,
      signature: asset.signature || '',
      key_id: asset.key_id || '',
      metadata: asset.metadata || {},
      created_at: asset.created_at?.toISOString?.() || null,
      updated_at: asset.updated_at?.toISOString?.() || null,
    };
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
