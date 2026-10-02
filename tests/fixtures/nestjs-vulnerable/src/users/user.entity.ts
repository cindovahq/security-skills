import { Exclude } from 'class-transformer';
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  displayName: string;

  @Exclude()
  @Column()
  passwordHash: string;

  @Column({ default: 'user' })
  role: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ nullable: true })
  tenantId: string;

  @Column({ nullable: true })
  avatarFile: string;

  @Column({ nullable: true })
  internalNotes: string;

  @CreateDateColumn()
  createdAt: Date;
}
