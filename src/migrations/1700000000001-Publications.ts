import { MigrationInterface, QueryRunner } from 'typeorm';

export class Publications1700000000001 implements MigrationInterface {
  name = 'Publications1700000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "publications" (
        "publication_id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "zone_id" character varying NOT NULL,
        "title" character varying NOT NULL,
        "type" character varying NOT NULL DEFAULT 'slideshow',
        "status" character varying NOT NULL DEFAULT 'draft',
        "version" integer NOT NULL DEFAULT 1,
        "items" jsonb NOT NULL DEFAULT '[]',
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_publications" PRIMARY KEY ("publication_id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_publications_zone_updated"
        ON "publications" ("zone_id", "updated_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "publications"`);
  }
}
