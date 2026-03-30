import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('content_assets')
@Index(['zone_id', 'created_at'])
export class ContentAsset {
  @PrimaryGeneratedColumn('uuid')
  asset_id: string;

  @Column()
  zone_id: string;

  @Column('text', { array: true, default: '{}' })
  zone_ids: string[];

  @Column()
  filename: string;

  @Column()
  content_type: string;

  @Column('bigint')
  file_size: number;

  @Column({ nullable: true })
  sha256_hash: string;

  @Column({ nullable: true })
  storage_key: string;

  @Column({ default: 'uploading' })
  status: string; // "uploading", "ready", "deleted"

  @Column({ nullable: true })
  signature: string;

  @Column({ nullable: true })
  key_id: string;

  @Column('jsonb', { default: '{}' })
  metadata: Record<string, string>;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
