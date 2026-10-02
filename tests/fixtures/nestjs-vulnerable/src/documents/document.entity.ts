import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class DocumentRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  ownerId: string;

  @Column()
  storedName: string;

  @Column()
  originalName: string;

  @CreateDateColumn()
  createdAt: Date;
}
