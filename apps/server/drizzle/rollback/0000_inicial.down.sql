-- DESFAZ a migration 0000_inicial. NÃO é executado por nenhum script: é para rodar à mão, conscientemente,
-- num banco de desenvolvimento/ensaio (ou em produção só depois de `npm run db:export` e com a cópia conferida).
-- Apaga TODAS as tabelas e dados do app no banco. O data/library.json e as imagens não são afetados.
BEGIN;
DROP TABLE IF EXISTS "import_jobs";
DROP TABLE IF EXISTS "entries";
DROP TABLE IF EXISTS "product_images";
DROP TABLE IF EXISTS "product_variants";
DROP TABLE IF EXISTS "products";
DROP TABLE IF EXISTS "users";
DROP TYPE IF EXISTS "public"."import_status";
DROP TYPE IF EXISTS "public"."image_role";
DROP TYPE IF EXISTS "public"."perfume_origin";
DROP TYPE IF EXISTS "public"."gender";
DROP TYPE IF EXISTS "public"."personal_rating";
DROP TYPE IF EXISTS "public"."list_kind";
DROP TYPE IF EXISTS "public"."visibility";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "hash" IS NOT NULL;
COMMIT;
