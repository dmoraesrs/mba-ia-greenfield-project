import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideos1795148126778 implements MigrationInterface {
  name = 'CreateVideos1795148126778';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."videos_status_enum" AS ENUM('draft', 'processing', 'ready', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "videos" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "public_id" character varying(11) NOT NULL, "channel_id" uuid NOT NULL, "status" "public"."videos_status_enum" NOT NULL DEFAULT 'draft', "original_filename" character varying(255) NOT NULL, "mime_type" character varying(100) NOT NULL, "size_bytes" bigint NOT NULL, "storage_key" character varying(512) NOT NULL, "upload_id" character varying(1024), "part_size_bytes" integer NOT NULL, "part_count" integer NOT NULL, "thumbnail_key" character varying(512), "duration_seconds" double precision, "metadata" jsonb, "failure_reason" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_videos_public_id" UNIQUE ("public_id"), CONSTRAINT "CHK_videos_part_count" CHECK ("part_count" BETWEEN 1 AND 10000), CONSTRAINT "CHK_videos_size_bytes" CHECK ("size_bytes" BETWEEN 1 AND 10737418240), CONSTRAINT "PK_e4c86c0cf95aff16e9fb8220f6b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_status_created_at" ON "videos" ("status", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_channel_id" ON "videos" ("channel_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_videos_channel_id"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_videos_status_created_at"`,
    );
    await queryRunner.query(`DROP TABLE "videos"`);
    await queryRunner.query(`DROP TYPE "public"."videos_status_enum"`);
  }
}
