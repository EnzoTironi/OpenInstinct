CREATE TABLE "memory_document" (
	"key" text PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"version" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_document_key_check" CHECK (length("memory_document"."key") BETWEEN 1 AND 512 AND trim("memory_document"."key") = "memory_document"."key"),
	CONSTRAINT "memory_document_content_check" CHECK (length("memory_document"."content") <= 4000)
);
