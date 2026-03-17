import { DataSource } from 'typeorm';
import { ContentAsset } from './src/content/content-asset.entity';
import { Init1700000000000 } from './src/migrations/1700000000000-Init';

export default new DataSource({
  type: 'postgres',
  url:
    process.env.DATABASE_URL ||
    'postgresql://campuscast:campuscast@localhost:5432/content_db',
  entities: [ContentAsset],
  migrations: [Init1700000000000],
});
