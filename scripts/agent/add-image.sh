#!/usr/bin/env bash
# Публикует локальную картинку в GitHub и печатает прямую ссылку для LinkedIn.
#
#   ./add-image.sh "/path/to/my picture.jpg"            имя очистится автоматически
#   ./add-image.sh "/path/to/pic.jpg" holstein-2026-07  своё имя (латиница-дефис)
#
# LinkedIn скачивает картинку по ссылке, поэтому имя всегда латиницей без пробелов,
# а файл кладётся в публичный репозиторий и отдаётся через raw.githubusercontent.

set -euo pipefail

# Корень репозитория — от расположения самого скрипта (scripts/agent/add-image.sh),
# а не жёстким путём: панель может быть запущена из любого каталога.
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMG_DIR="$REPO_DIR/images"
BRANCH="main"
RAW_BASE="https://raw.githubusercontent.com/Olianayda/avare/$BRANCH/images"

die() { printf '❌ %s\n' "$1" >&2; exit 1; }

SRC="${1:-}"
SLUG="${2:-}"
[[ -n "$SRC" ]] || die "Укажи путь к картинке: ./add-image.sh \"/path/to/pic.jpg\""
[[ -f "$SRC" ]] || die "Файл не найден: $SRC"

ext="${SRC##*.}"
ext="$(echo "$ext" | tr '[:upper:]' '[:lower:]')"
case "$ext" in
  jpg|jpeg|png|webp) ;;
  *) die "Формат .$ext LinkedIn не жалует. Нужен jpg, png или webp." ;;
esac

# Имя файла: из своего slug либо из имени источника, но всегда чистим.
base="${SLUG:-$(basename "$SRC" ".$ext")}"
clean="$(echo "$base" \
  | tr '[:upper:]' '[:lower:]' \
  | sed 's/[^a-z0-9]/-/g; s/-\{2,\}/-/g; s/^-//; s/-$//')"
[[ -n "$clean" ]] || clean="image"
# Если имя было целиком кириллицей и схлопнулось — подстрахуемся датой.
[[ "$clean" =~ ^-*$ ]] && clean="avare-$(date +%Y%m)"

fname="avare-${clean}-$(date +%Y%m).${ext}"
# Если такое имя уже есть — добавим короткий хвост, чтобы не перетереть.
if [[ -f "$IMG_DIR/$fname" ]]; then
  fname="avare-${clean}-$(date +%Y%m)-$(date +%H%M%S).${ext}"
fi

# Сначала убеждаемся, что перед нами репозиторий, и только потом что-то создаём:
# иначе mkdir насоздаёт каталогов там, где их быть не должно, а git упадёт позже и невнятно.
git -C "$REPO_DIR" rev-parse --git-dir >/dev/null 2>&1 \
  || die "Не репозиторий: $REPO_DIR. Картинки публикуются коммитом, без git отправлять некуда."

mkdir -p "$IMG_DIR"
cp "$SRC" "$IMG_DIR/$fname"

cd "$REPO_DIR"
git add "images/$fname"
git -c user.name="Olga Nayda" -c user.email="olianayda@gmail.com" \
  commit -q -m "Add image $fname" || die "Нечего коммитить (файл уже в репозитории?)"
git push -q origin "$BRANCH" || die "Не удалось запушить. Проверь доступ к GitHub."

URL="$RAW_BASE/$fname"

# Проверяем, что ссылка реально отдаёт картинку (raw обновляется за пару секунд).
sleep 3
code=$(curl -sSL --connect-timeout 10 --max-time 30 -o /dev/null -w '%{http_code}' "$URL" || echo 000)
if [[ "$code" == "200" ]]; then
  echo "✅ Опубликовано и проверено (HTTP 200):"
else
  echo "⚠️  Запушено, но ссылка пока отдаёт HTTP $code — raw иногда думает до минуты. Проверь через минуту."
fi
echo "$URL"
