import { ContentService } from '../src/content/content.service';

describe('ContentService publication lifecycle', () => {
  const storage = {};

  let assetRepo: Record<string, jest.Mock>;
  let publicationRepo: {
    findOne: jest.Mock;
    remove: jest.Mock;
    save: jest.Mock;
  };
  let auditAppend: jest.Mock;
  let service: ContentService;

  beforeEach(() => {
    jest.resetAllMocks();
    assetRepo = {};
    publicationRepo = {
      findOne: jest.fn(),
      remove: jest.fn(async (value) => value),
      save: jest.fn(async (value) => value),
    };
    auditAppend = jest.fn().mockResolvedValue(undefined);
    service = new ContentService(assetRepo as any, publicationRepo as any, storage as any);
    (service as any).auditClient = {
      append: auditAppend,
    };
  });

  it('archives a publication through deletePublication', async () => {
    publicationRepo.findOne.mockResolvedValue({
      publication_id: 'pub-1',
      zone_id: 'zone-1',
      title: 'Morning playlist',
      type: 'slideshow',
      status: 'draft',
      version: 2,
      items: [],
      metadata: {},
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    });

    const archived = await service.deletePublication('pub-1');

    expect(publicationRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      publication_id: 'pub-1',
      status: 'archived',
      version: 3,
    }));
    expect(archived.status).toBe('archived');
    expect(auditAppend).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'publication.archived',
      resource_id: 'pub-1',
      action: 'archive',
    }));
  });

  it('restores an archived publication to draft', async () => {
    publicationRepo.findOne.mockResolvedValue({
      publication_id: 'pub-2',
      zone_id: 'zone-2',
      title: 'Lobby loop',
      type: 'slideshow',
      status: 'archived',
      version: 4,
      items: [],
      metadata: {},
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    });

    const restored = await service.restorePublication('pub-2');

    expect(publicationRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      publication_id: 'pub-2',
      status: 'draft',
      version: 5,
    }));
    expect(restored.status).toBe('draft');
    expect(auditAppend).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'publication.restored',
      resource_id: 'pub-2',
      action: 'restore',
    }));
  });

  it('permanently deletes a publication', async () => {
    publicationRepo.findOne.mockResolvedValue({
      publication_id: 'pub-3',
      zone_id: 'zone-3',
      title: 'Event slides',
      type: 'slideshow',
      status: 'draft',
      version: 1,
      items: [],
      metadata: {},
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    });

    const deleted = await service.deletePublicationPermanently('pub-3');

    expect(publicationRepo.remove).toHaveBeenCalledWith(expect.objectContaining({
      publication_id: 'pub-3',
    }));
    expect(deleted).toEqual({
      deleted: true,
      publication_id: 'pub-3',
      zone_id: 'zone-3',
    });
    expect(auditAppend).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'publication.deleted',
      resource_id: 'pub-3',
      action: 'delete',
    }));
  });
});
