import { ContentService } from '../src/content/content.service';

function makeAssetQueryBuilder(rows: unknown[]) {
  return {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(rows),
  };
}

describe('ContentService.resolveAssets', () => {
  const publicationRepo = {
    find: jest.fn(),
  };
  const storage = {
    getPresignedDownloadUrl: jest.fn(),
  };

  let repo: {
    createQueryBuilder: jest.Mock;
  };
  let service: ContentService;

  beforeEach(() => {
    jest.resetAllMocks();
    repo = {
      createQueryBuilder: jest.fn(),
    };
    service = new ContentService(repo as any, publicationRepo as any, storage as any);
  });

  it('returns resolved descriptors and missing asset ids for the requested zone availability', async () => {
    const queryBuilder = makeAssetQueryBuilder([
      {
        asset_id: 'asset-1',
        zone_id: 'zone-1',
        zone_ids: ['zone-1'],
        filename: 'video.mp4',
        content_type: 'video/mp4',
        file_size: '1024',
        sha256_hash: 'hash-1',
        storage_key: 'zone-1/x/video.mp4',
        metadata: { locale: 'ru' },
      },
    ]);
    repo.createQueryBuilder.mockReturnValue(queryBuilder);
    storage.getPresignedDownloadUrl.mockResolvedValue('https://cdn.example.com/asset-1');

    const result = await service.resolveAssets('zone-1', ['asset-1', 'asset-2']);

    expect(repo.createQueryBuilder).toHaveBeenCalledWith('asset');
    expect(queryBuilder.where).toHaveBeenCalledWith('asset.status = :status', { status: 'ready' });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('asset.asset_id IN (:...assetIds)', {
      assetIds: ['asset-1', 'asset-2'],
    });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('asset.zone_ids && ARRAY[:...zoneIds]::text[]', {
      zoneIds: ['zone-1'],
    });
    expect(result.assets).toEqual([
      {
        asset_id: 'asset-1',
        filename: 'video.mp4',
        content_type: 'video/mp4',
        file_size: 1024,
        sha256_hash: 'hash-1',
        download_url: 'https://cdn.example.com/asset-1',
        metadata: { locale: 'ru' },
        zone_ids: ['zone-1'],
      },
    ]);
    expect(result.missing_asset_ids).toEqual(['asset-2']);
  });

  it('returns empty arrays when no asset ids are requested', async () => {
    const result = await service.resolveAssets('zone-1', []);

    expect(result).toEqual({ assets: [], missing_asset_ids: [] });
    expect(repo.createQueryBuilder).not.toHaveBeenCalled();
  });
});
