CREATE TYPE "public"."operational_anomaly_type" AS ENUM('missing_object', 'orphaned_object', 'stale_expiration', 'failed_cleanup');--> statement-breakpoint
ALTER TABLE "operational_anomalies" ALTER COLUMN "type" SET DATA TYPE "public"."operational_anomaly_type" USING "type"::"public"."operational_anomaly_type";--> statement-breakpoint
CREATE INDEX "download_events_file_event_idx" ON "download_events" USING btree ("file_id","event_type");--> statement-breakpoint
CREATE INDEX "reports_file_status_idx" ON "reports" USING btree ("file_id","status");