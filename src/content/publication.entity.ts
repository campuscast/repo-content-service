import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('publications')
@Index(['zone_id', 'updated_at'])
export class Publication {
  @PrimaryGeneratedColumn('uuid')
  publication_id: string;

  @Column()
  zone_id: string;

  @Column()
  title: string;

  @Column({ default: 'slideshow' })
  type: string;

  @Column({ default: 'draft' })
  status: string;

  @Column({ default: 1 })
  version: number;

  @Column('jsonb', { default: '[]' })
  items: Array<Record<string, unknown>>;

  @Column('jsonb', { default: '{}' })
  metadata: Record<string, unknown>;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
