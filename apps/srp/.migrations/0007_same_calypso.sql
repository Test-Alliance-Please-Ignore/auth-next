ALTER TABLE "srp_requests" DROP CONSTRAINT "srp_requests_killmail_id_unique";--> statement-breakpoint
ALTER TABLE "srp_comments" DROP CONSTRAINT "srp_comments_request_id_srp_requests_id_fk";
--> statement-breakpoint
ALTER TABLE "srp_payment_alerts" DROP CONSTRAINT "srp_payment_alerts_request_id_srp_requests_id_fk";
--> statement-breakpoint
ALTER TABLE "srp_request_history" DROP CONSTRAINT "srp_request_history_request_id_srp_requests_id_fk";
--> statement-breakpoint
DROP INDEX "srp_requests_killmail_id_idx";--> statement-breakpoint
ALTER TABLE "srp_comments" ALTER COLUMN "request_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "srp_payment_alerts" ALTER COLUMN "request_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "srp_request_history" ALTER COLUMN "request_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "srp_requests" ALTER COLUMN "id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "srp_requests" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "srp_requests" DROP COLUMN "killmail_id";