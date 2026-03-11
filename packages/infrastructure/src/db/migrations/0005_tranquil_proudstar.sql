CREATE TYPE "public"."file_moderation_action" AS ENUM('hide', 'restore', 'delete');--> statement-breakpoint
CREATE TABLE "file_moderation_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid,
	"action" "file_moderation_action" NOT NULL,
	"previous_status" "file_status" NOT NULL,
	"next_status" "file_status" NOT NULL,
	"actor_github_id" varchar(64) NOT NULL,
	"actor_github_login" varchar(255) NOT NULL,
	"reason" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_moderation_actions_actor_github_id_numeric_chk" CHECK ("file_moderation_actions"."actor_github_id" ~ '^[0-9]+$'),
	CONSTRAINT "file_moderation_actions_reason_length_chk" CHECK ("file_moderation_actions"."reason" IS NULL OR length("file_moderation_actions"."reason") <= 500)
);
--> statement-breakpoint
ALTER TABLE "file_moderation_actions" ADD CONSTRAINT "file_moderation_actions_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_moderation_actions_file_id_idx" ON "file_moderation_actions" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "file_moderation_actions_action_idx" ON "file_moderation_actions" USING btree ("action");--> statement-breakpoint
CREATE INDEX "file_moderation_actions_created_at_idx" ON "file_moderation_actions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "file_moderation_actions_file_created_at_idx" ON "file_moderation_actions" USING btree ("file_id","created_at");