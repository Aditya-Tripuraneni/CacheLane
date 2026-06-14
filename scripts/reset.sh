#!/usr/bin/env bash
set -euo pipefail

DB="${CACHELANE_HOME:-$HOME/.cachelane}/cachelane.db"

if [[ ! -f "$DB" ]]; then
  echo "No database found at $DB — already clean."
  exit 0
fi

SIZE=$(du -h "$DB" | cut -f1)
echo "Deleting CacheLane database: $DB ($SIZE)"
rm "$DB"
echo "Done. Fresh DB will be created on next proxy or CLI run."
