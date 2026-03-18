import { ContentService } from '../src/content/content.service';

describe('ContentService.resolveAssets', () => {
  const repo = {
    find: jest.fn(),
  };
  const publicationRepo = {
    find: jest.fn(),
  };
  const storage = {
    getPresignedDownloadUrl: jest.fn(),
  };

  let service: ContentService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ContentService(repo as any, publicationRepo as any, storage as any);
  });

  it('returns resolved descriptors and missing asset ids', async () => {
    repo.find.mockResolvedValue([
      {
        asset_id: 'asset-1',
        zone_id: 'zone-1',
        filename: 'video.mp4',
        content_type: 'video/mp4',
        file_size: '1024',
        sha256_hash: 'hash-1',
        storage_key: 'zone-1/x/video.mp4',
        metadata: { locale: 'ru' },
      },
    ]);
    storage.getPresignedDownloadUrl.mockResolvedValue('https://cdn.example.com/asset-1');

    const result = await service.resolveAssets('zone-1', ['asset-1', 'asset-2']);

    expect(repo.find).toHaveBeenCalledTimes(1);
    const where = repo.find.mock.calls[0][0].where;
    expect(where.zone_id).toBe('zone-1');
    expect(where.status).toBe('ready');

    expect(result.assets).toEqual([
      {
        asset_id: 'asset-1',
        filename: 'video.mp4',
        content_type: 'video/mp4',
        file_size: 1024,
        sha256_hash: 'hash-1',
        download_url: 'https://cdn.example.com/asset-1',
        metadata: { locale: 'ru' },
      },
    ]);
    expect(result.missing_asset_ids).toEqual(['asset-2']);
  });

  it('returns empty arrays when no asset ids requested', async () => {
    const result = await service.resolveAssets('zone-1', []);
    expect(result).toEqual({ assets: [], missing_asset_ids: [] });
    expect(repo.find).not.toHaveBeenCalled();
  });
});
