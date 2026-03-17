import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Real initial migration for content_db.
 * Tables: content_assets
 */
export class Init1700000000000 implements MigrationInterface {
  name = 'Init1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "content_assets" (
        "asset_id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "zone_id" character varying NOT NULL,
        "filename" character varying NOT NULL,
        "content_type" character varying NOT NULL,
        "file_size" bigint NOT NULL,
        "sha256_hash" character varying,
        "storage_key" character varying,
        "status" character varying NOT NULL DEFAULT 'uploading',
        "signature" character varying,
        "key_id" character varying,
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_content_assets" PRIMARY KEY ("asset_id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_content_assets_zone_created"
        ON "content_assets" ("zone_id", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "content_assets"`);
  }
}
