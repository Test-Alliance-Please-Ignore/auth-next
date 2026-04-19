ALTER TABLE "srp_requests" DROP CONSTRAINT "srp_requests_payment_token_unique";--> statement-breakpoint
DROP INDEX "srp_requests_payment_token_idx";--> statement-breakpoint
ALTER TABLE "srp_requests" ADD COLUMN "context_text" text;--> statement-breakpoint
ALTER TABLE "srp_requests" DROP COLUMN "requested_amount";--> statement-breakpoint
ALTER TABLE "srp_requests" DROP COLUMN "payment_token";