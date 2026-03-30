import { BadRequestException } from '@nestjs/common';
import { ContentService } from '../src/content/content.service';

describe('ContentService asset availability', () => {
  const storage = {
    getPresignedDownloadUrl: jest.fn(),
    deleteObject: jest.fn(),
  };

  let assetRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    remove: jest.Mock;
    save: jest.Mock;
  };
  let publicationRepo: {
    create: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
  };
  let service: ContentService;

  beforeEach(() => {
    jest.resetAllMocks();
    assetRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      remove: jest.fn(async (value) => value),
      save: jest.fn(async (value) => value),
    };
    publicationRepo = {
      create: jest.fn((value) => value),
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(async (value) => ({
        publication_id: 'pub-copy',
        version: 1,
        created_at: new Date('2026-01-02T00:00:00Z'),
        updated_at: new Date('2026-01-02T00:00:00Z'),
        ...value,
      })),
    };
    service = new ContentService(assetRepo as any, publicationRepo as any, storage as any);
    (service as any).auditClient = {
      append: jest.fn().mockResolvedValue(undefined),
    };
  });

  it('shares referenced assets with the target zone when a publication is copied', async () => {
    publicationRepo.findOne.mockResolvedValue({
      publication_id: 'pub-source',
      zone_id: 'zone-source',
      title: 'Source publication',
      type: 'slideshow',
      status: 'active',
      version: 3,
      items: [
        { type: 'video_asset', video: { asset_id: 'asset-video' } },
        { type: 'custom_slide', slide: { image_asset_id: 'asset-image' } },
      ],
      metadata: { theme: 'morning' },
    });
    assetRepo.find.mockResolvedValue([
      {
        asset_id: 'asset-video',
        zone_id: 'zone-source',
        zone_ids: ['zone-source'],
        status: 'ready',
      },
      {
        asset_id: 'asset-image',
        zone_id: 'zone-source',
        zone_ids: ['zone-source'],
        status: 'ready',
      },
    ]);

    const copied = await service.copyPublication('pub-source', {
      zone_id: 'zone-target',
      title: 'Copied publication',
    });

    expect(assetRepo.save).toHaveBeenCalledWith([
      expect.objectContaining({
        asset_id: 'asset-video',
        zone_ids: ['zone-source', 'zone-target'],
      }),
      expect.objectContaining({
        asset_id: 'asset-image',
        zone_ids: ['zone-source', 'zone-target'],
      }),
    ]);
    expect(copied.zone_id).toBe('zone-target');
    expect(copied.title).toBe('Copied publication');
  });

  it('blocks deleting an asset that is still referenced by publications in available zones', async () => {
    assetRepo.findOne.mockResolvedValue({
      asset_id: 'asset-1',
      zone_id: 'zone-1',
      zone_ids: ['zone-1', 'zone-2'],
      status: 'ready',
    });
    publicationRepo.find.mockResolvedValue([
      {
        publication_id: 'pub-1',
        zone_id: 'zone-2',
        status: 'draft',
        items: [{ type: 'video_asset', video: { asset_id: 'asset-1' } }],
      },
    ]);

    try {
      await service.deleteAsset('asset-1');
      throw new Error('Expected deleteAsset to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toContain('Cannot delete asset used in publications: zone-2');
    }
    expect(assetRepo.save).not.toHaveBeenCalled();
  });

  it('rejects removing the last available zone through availability update', async () => {
    assetRepo.findOne.mockResolvedValue({
      asset_id: 'asset-1',
      zone_id: 'zone-1',
      zone_ids: ['zone-1'],
      status: 'ready',
    });
    publicationRepo.find.mockResolvedValue([]);

    await expect(service.updateAssetAvailability('asset-1', [])).rejects.toThrow(
      'Removing access from the last available zone would orphan this asset.',
    );
    expect(assetRepo.save).not.toHaveBeenCalled();
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('physically deletes the storage object and removes the asset record', async () => {
    assetRepo.findOne.mockResolvedValue({
      asset_id: 'asset-1',
      zone_id: 'zone-1',
      zone_ids: ['zone-1'],
      filename: 'asset.jpg',
      content_type: 'image/jpeg',
      file_size: 123,
      sha256_hash: 'hash',
      storage_key: 'zone-1/asset.jpg',
      status: 'ready',
      signature: 'sig',
      key_id: 'key',
      metadata: {},
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    });
    publicationRepo.find.mockResolvedValue([]);

    const deleted = await service.deleteAsset('asset-1');

    expect(storage.deleteObject).toHaveBeenCalledWith('zone-1/asset.jpg');
    expect(assetRepo.remove).toHaveBeenCalledWith(expect.objectContaining({ asset_id: 'asset-1' }));
    expect(deleted.status).toBe('deleted');
    expect(deleted.zone_ids).toEqual([]);
  });
});
