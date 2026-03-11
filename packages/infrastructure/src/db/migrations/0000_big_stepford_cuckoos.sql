CREATE TYPE "public"."download_event_type" AS ENUM('started', 'completed', 'failed', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."file_status" AS ENUM('pending_upload', 'active', 'expiring', 'expired', 'hidden', 'deleted', 'consumed', 'missing');--> statement-breakpoint
CREATE TYPE "public"."report_reason" AS ENUM('illegal_content', 'copyright_violation', 'malware', 'spam', 'other');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('pending', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_id" varchar(64) NOT NULL,
	"github_login" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "download_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"event_type" "download_event_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_hash" varchar(64),
	"context" jsonb
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" varchar(64) NOT NULL,
	"object_key" varchar(512) NOT NULL,
	"original_filename" varchar(512) NOT NULL,
	"sanitized_filename" varchar(512) NOT NULL,
	"mime_type" varchar(255) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"status" "file_status" DEFAULT 'pending_upload' NOT NULL,
	"allow_preview" boolean DEFAULT false NOT NULL,
	"one_time_download" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"report_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operational_anomalies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(64) NOT NULL,
	"file_id" uuid,
	"details" jsonb,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" text
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"reason" "report_reason" NOT NULL,
	"message" text,
	"status" "report_status" DEFAULT 'pending' NOT NULL,
	"resolved_by" varchar(255),
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_hash" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" varchar(255) PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "download_events" ADD CONSTRAINT "download_events_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_anomalies" ADD CONSTRAINT "operational_anomalies_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_sessions_github_id_idx" ON "admin_sessions" USING btree ("github_id");--> statement-breakpoint
CREATE INDEX "admin_sessions_expires_at_idx" ON "admin_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "download_events_file_id_idx" ON "download_events" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "download_events_event_type_idx" ON "download_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "download_events_created_at_idx" ON "download_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "files_token_uidx" ON "files" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "files_object_key_uidx" ON "files" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "files_status_idx" ON "files" USING btree ("status");--> statement-breakpoint
CREATE INDEX "files_expires_at_idx" ON "files" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "files_uploaded_at_idx" ON "files" USING btree ("uploaded_at");--> statement-breakpoint
CREATE INDEX "files_report_count_idx" ON "files" USING btree ("report_count");--> statement-breakpoint
CREATE INDEX "operational_anomalies_type_idx" ON "operational_anomalies" USING btree ("type");--> statement-breakpoint
CREATE INDEX "operational_anomalies_file_id_idx" ON "operational_anomalies" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "operational_anomalies_detected_at_idx" ON "operational_anomalies" USING btree ("detected_at");--> statement-breakpoint
CREATE INDEX "operational_anomalies_resolved_at_idx" ON "operational_anomalies" USING btree ("resolved_at");--> statement-breakpoint
CREATE INDEX "reports_file_id_idx" ON "reports" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "reports_status_idx" ON "reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reports_created_at_idx" ON "reports" USING btree ("created_at");