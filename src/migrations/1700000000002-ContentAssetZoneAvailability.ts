import { MigrationInterface, QueryRunner } from 'typeorm';

export class ContentAssetZoneAvailability1700000000002 implements MigrationInterface {
  name = 'ContentAssetZoneAvailability1700000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "content_assets"
      ADD COLUMN IF NOT EXISTS "zone_ids" text[] NOT NULL DEFAULT '{}'
    `);

    await queryRunner.query(`
      UPDATE "content_assets"
      SET "zone_ids" = ARRAY["zone_id"]
      WHERE cardinality("zone_ids") = 0
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_content_assets_zone_ids_gin"
        ON "content_assets"
        USING GIN ("zone_ids")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_content_assets_zone_ids_gin"`);
    await queryRunner.query(`
      ALTER TABLE "content_assets"
      DROP COLUMN IF EXISTS "zone_ids"
    `);
  }
}
