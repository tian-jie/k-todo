#!/bin/sh
# KAnki-like launcher: copy app content to mesquite sandbox,
# register an app id in appreg.db, then launch via app://<id>.

LOG_FILE="/mnt/us/extensions/k-todo/ktodo-launch.log"
SOURCE_DIR="/mnt/us/extensions/k-todo/content"
TARGET_ROOT="/var/local/mesquite"
RUN_ID="$(date +%s)"
TARGET_DIR="$TARGET_ROOT/k-todo-$RUN_ID"
DB="/var/local/appreg.db"
APP_ID="xyz.tian.ktodo"

exec >> "$LOG_FILE" 2>&1

echo "========== $(date '+%Y-%m-%d %H:%M:%S') =========="
echo "[INFO] launcher start"
echo "[INFO] source=$SOURCE_DIR"
echo "[INFO] target=$TARGET_DIR"
echo "[INFO] db=$DB"
echo "[INFO] app_id=$APP_ID"

if [ ! -d "$SOURCE_DIR" ]; then
  echo "[ERROR] source dir not found"
  exit 1
fi

if [ ! -f "$SOURCE_DIR/index.html" ]; then
  echo "[ERROR] source index.html not found"
  ls -la "$SOURCE_DIR"
  exit 1
fi

cp -r "$SOURCE_DIR" "$TARGET_DIR"
RET=$?
if [ "$RET" -ne 0 ]; then
  echo "[ERROR] copy to mesquite failed: $RET"
  exit "$RET"
fi

# Keep only the latest launch directory to avoid unbounded growth.
for old_dir in "$TARGET_ROOT"/k-todo-*; do
  if [ -d "$old_dir" ] && [ "$old_dir" != "$TARGET_DIR" ]; then
    rm -rf "$old_dir"
  fi
done

if [ ! -f "$DB" ]; then
  echo "[ERROR] appreg db not found: $DB"
  exit 2
fi

sqlite3 "$DB" <<EOF
INSERT OR IGNORE INTO interfaces(interface)
VALUES('application');

INSERT OR IGNORE INTO handlerIds(handlerId)
VALUES('$APP_ID');

INSERT OR REPLACE INTO properties(handlerId,name,value)
VALUES('$APP_ID','lipcId','$APP_ID');

INSERT OR REPLACE INTO properties(handlerId,name,value)
VALUES('$APP_ID','command','/usr/bin/mesquite -l $APP_ID -c file://$TARGET_DIR/');

INSERT OR REPLACE INTO properties(handlerId,name,value)
VALUES('$APP_ID','supportedOrientation','U');
EOF

RET=$?
if [ "$RET" -ne 0 ]; then
  echo "[ERROR] sqlite register failed: $RET"
  exit "$RET"
fi

# Stop previous running instance to avoid stale process reuse.
lipc-set-prop com.lab126.appmgrd stop app://$APP_ID >/dev/null 2>&1
echo "[INFO] stop requested for app://$APP_ID"

nohup lipc-set-prop com.lab126.appmgrd start app://$APP_ID >/dev/null 2>&1 &
RET=$?
echo "[INFO] launch requested, exit=$RET"
exit "$RET"
