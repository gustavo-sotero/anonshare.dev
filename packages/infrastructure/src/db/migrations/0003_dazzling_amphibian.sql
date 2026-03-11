ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_github_id_numeric_chk" CHECK ("admin_sessions"."github_id" ~ '^[0-9]+$');--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_report_count_nonnegative_chk" CHECK ("files"."report_count" >= 0);--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_message_length_chk" CHECK ("reports"."message" IS NULL OR length("reports"."message") <= 1000);--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolution_consistency_chk" CHECK ((
        "reports"."status" = 'pending' AND "reports"."resolved_by" IS NULL AND "reports"."resolved_at" IS NULL
      ) OR (
        "reports"."status" IN ('resolved', 'dismissed') AND "reports"."resolved_by" IS NOT NULL AND "reports"."resolved_at" IS NOT NULL
      ));