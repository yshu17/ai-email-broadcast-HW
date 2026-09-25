ALTER TYPE "public"."campaign_status" ADD VALUE 'SCHEDULED' BEFORE 'QUEUED';--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_scheduled_requires_time" CHECK ("campaigns"."status"::text <> 'SCHEDULED' OR "campaigns"."scheduled_at" IS NOT NULL);