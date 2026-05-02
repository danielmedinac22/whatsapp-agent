ALTER TABLE "dropi_connection" ADD COLUMN "assets_base_url" text DEFAULT 'https://d2ob47cxeawi8a.cloudfront.net' NOT NULL;--> statement-breakpoint
ALTER TABLE "dropi_orders" ADD COLUMN "guide_pdf_path" text;--> statement-breakpoint
ALTER TABLE "dropi_orders" ADD COLUMN "guide_pdf_file" text;