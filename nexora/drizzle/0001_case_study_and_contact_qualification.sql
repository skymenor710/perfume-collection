ALTER TABLE "contact_requests" ADD COLUMN "budget" text;--> statement-breakpoint
ALTER TABLE "contact_requests" ADD COLUMN "timeline" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "challenge" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "solution" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "results" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "case_url" text;