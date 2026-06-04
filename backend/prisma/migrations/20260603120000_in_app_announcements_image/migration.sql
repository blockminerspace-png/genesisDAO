-- Imagem opcional no popup in-app (banner/GIF)

ALTER TABLE "in_app_announcements" ADD COLUMN IF NOT EXISTS "image_url" TEXT;
