#!/bin/bash

# Export local database to SQL file
echo "📦 Exporting local PostgreSQL database..."

# Set your local database credentials
LOCAL_DB="postgres"
LOCAL_USER="postgres"
LOCAL_HOST="localhost"
LOCAL_PORT="5432"

# Export to SQL file
pg_dump -h "$LOCAL_HOST" -p "$LOCAL_PORT" -U "$LOCAL_USER" \
  --clean --if-exists \
  --no-owner --no-acl \
  --disable-triggers \
  "$LOCAL_DB" > local_backup.sql

echo "✅ Exported to local_backup.sql"
echo "Size: $(du -h local_backup.sql | cut -f1)"
