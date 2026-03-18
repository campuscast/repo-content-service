import { ContentService } from '../src/content/content.service';

describe('ContentService.resolveManifestDependencies', () => {
  const assetRepo = {
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
    service = new ContentService(assetRepo as any, publicationRepo as any, storage as any);
  });

  it('resolves direct and publication-derived assets and reports missing publications', async () => {
    publicationRepo.find.mockResolvedValue([
      {
        publication_id: 'pub-1',
        zone_id: 'zone-1',
        title: 'Morning playlist',
        type: 'slideshow',
        status: 'active',
        version: 2,
        items: [
          { type: 'video', asset_id: 'asset-video' },
          { type: 'slide', image_asset_id: 'asset-image' },
        ],
        metadata: {},
        created_at: new Date('2026-01-01T00:00:00Z'),
        updated_at: new Date('2026-01-02T00:00:00Z'),
      },
    ]);

    assetRepo.find.mockResolvedValue([
      {
        asset_id: 'asset-direct',
        zone_id: 'zone-1',
        filename: 'direct.mp4',
        content_type: 'video/mp4',
        file_size: 100,
        sha256_hash: 'hash-direct',
        storage_key: 'zone-1/direct.mp4',
        metadata: {},
      },
      {
        asset_id: 'asset-video',
        zone_id: 'zone-1',
        filename: 'video.mp4',
        content_type: 'video/mp4',
        file_size: 200,
        sha256_hash: 'hash-video',
        storage_key: 'zone-1/video.mp4',
        metadata: {},
      },
      {
        asset_id: 'asset-image',
        zone_id: 'zone-1',
        filename: 'image.png',
        content_type: 'image/png',
        file_size: 50,
        sha256_hash: 'hash-image',
        storage_key: 'zone-1/image.png',
        metadata: {},
      },
    ]);

    storage.getPresignedDownloadUrl.mockImplementation(
      async (storageKey: string) => `https://cdn.example.com/${storageKey}`,
    );

    const result = await service.resolveManifestDependencies({
      zone_id: 'zone-1',
      asset_ids: ['asset-direct'],
      publication_ids: ['pub-1', 'pub-missing'],
    });

    expect(publicationRepo.find).toHaveBeenCalledTimes(1);
    expect(result.missing_publication_ids).toEqual(['pub-missing']);
    expect(result.publications).toHaveLength(1);
    expect(result.assets.map((asset) => asset.asset_id).sort()).toEqual(
      ['asset-direct', 'asset-image', 'asset-video'].sort(),
    );
    expect(result.missing_asset_ids).toEqual([]);
  });
});
