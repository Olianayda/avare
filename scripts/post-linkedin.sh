#!/usr/bin/env bash
# Отправка поста на страницу компании Avare в LinkedIn через вебхук Make.
#
# Использование:
#   ./post-linkedin.sh -t post.txt -i https://.../avare-tema-2026-07.webp -a "Описание картинки"
#   ./post-linkedin.sh -T "Текст поста одной строкой" -i https://... -a "Описание"
#
# Флаги:
#   -t FILE   файл с текстом поста (переносы строк сохраняются)
#   -T TEXT   текст поста прямо в командной строке
#   -i URL    прямая ссылка на картинку
#   -a TEXT   alt-текст картинки
#   -n        сухой прогон: всё проверить, но НЕ отправлять
#
# Вебхук можно переопределить переменной окружения MAKE_WEBHOOK_URL.

set -euo pipefail

TEXT_FILE=""
TEXT=""
IMAGE_URL=""
ALT_TEXT=""
DRY_RUN=0

while getopts "t:T:i:a:nh" opt; do
  case "$opt" in
    t) TEXT_FILE="$OPTARG" ;;
    T) TEXT="$OPTARG" ;;
    i) IMAGE_URL="$OPTARG" ;;
    a) ALT_TEXT="$OPTARG" ;;
    n) DRY_RUN=1 ;;
    h) sed -n '2,20p' "$0"; exit 0 ;;
    *) exit 2 ;;
  esac
done

die() { printf '❌ %s\n' "$1" >&2; exit 1; }

# Вебхук НЕ хранится в коде — репозиторий публичный. Берётся из переменной
# окружения MAKE_WEBHOOK_URL либо из локального файла scripts/agent/.webhook.local
# (он в .gitignore и в репозиторий не попадает).
WEBHOOK="${MAKE_WEBHOOK_URL:-}"
if [[ -z "$WEBHOOK" ]]; then
  _wf="$(dirname "$0")/agent/.webhook.local"
  [[ -f "$_wf" ]] && WEBHOOK="$(tr -d '[:space:]' < "$_wf")"
fi
[[ -n "$WEBHOOK" ]] || die "Нет вебхука Make. Положи URL в scripts/agent/.webhook.local или задай MAKE_WEBHOOK_URL."

# --- 1. Текст поста ---------------------------------------------------------
if [[ -n "$TEXT_FILE" ]]; then
  [[ -f "$TEXT_FILE" ]] || die "Файл с текстом не найден: $TEXT_FILE"
  TEXT="$(cat "$TEXT_FILE")"
fi
[[ -n "$TEXT" ]]      || die "Нет текста поста. Передай -t файл.txt или -T \"текст\""
[[ -n "$IMAGE_URL" ]] || die "Нет ссылки на картинку. Передай -i URL"
[[ -n "$ALT_TEXT" ]]  || die "Нет alt-текста. Передай -a \"описание картинки\""

# LinkedIn режет посты длиннее 3000 символов.
LEN=$(printf '%s' "$TEXT" | wc -m | tr -d ' ')
if (( LEN > 3000 )); then
  die "Текст $LEN символов, лимит LinkedIn — 3000. Сократи."
fi

# --- 2. Проверка имени файла картинки --------------------------------------
FILENAME="${IMAGE_URL##*/}"
FILENAME="${FILENAME%%\?*}"          # отрезаем ?query, если есть

if [[ "$IMAGE_URL" != https://* ]]; then
  die "Ссылка на картинку должна начинаться с https:// — LinkedIn не берёт http."
fi
if [[ "$FILENAME" =~ [^A-Za-z0-9._-] ]]; then
  die "В имени файла есть пробелы, кириллица или %-кодирование: '$FILENAME'
   Переименуй латиницей без пробелов, например: avare-tema-2026-07.webp"
fi

# --- 3. Проверка, что картинка реально отдаётся -----------------------------
echo "→ Проверяю картинку: $IMAGE_URL"
HTTP_INFO=$(curl -sSL --connect-timeout 10 --max-time 30 \
  -o /dev/null -w '%{http_code} %{content_type} %{size_download}' "$IMAGE_URL") || \
  die "Не удалось скачать картинку (сеть, таймаут или домен недоступен)."

read -r CODE CTYPE SIZE <<< "$HTTP_INFO"

[[ "$CODE" == "200" ]] || die "Картинка отдаёт HTTP $CODE вместо 200. Постить нельзя."
[[ "$CTYPE" == image/* ]] || die "По ссылке не картинка, а '$CTYPE'.
   Скорее всего это HTML-страница просмотра, а не прямой файл.
   Для Google Drive нужна ссылка вида https://drive.google.com/uc?export=download&id=ФАЙЛ_ID"
(( SIZE > 1000 )) || die "Файл подозрительно маленький ($SIZE байт) — вероятно, заглушка."

printf '✅ Картинка ОК: %s, %s байт\n' "$CTYPE" "$SIZE"

# --- 4. Собираем JSON (python сам экранирует переносы и кавычки) -----------
PAYLOAD=$(TEXT="$TEXT" IMAGE_URL="$IMAGE_URL" ALT_TEXT="$ALT_TEXT" python3 -c '
import json, os
print(json.dumps({
    "linkedin_post": os.environ["TEXT"],
    "image_url":     os.environ["IMAGE_URL"],
    "alt_text":      os.environ["ALT_TEXT"],
}, ensure_ascii=False))
')

if (( DRY_RUN )); then
  echo "— сухой прогон, ничего не отправлено —"
  echo "Текст: $LEN символов"
  echo "$PAYLOAD"
  exit 0
fi

# --- 5. Отправка ------------------------------------------------------------
echo "→ Отправляю в Make…"
RESP=$(curl -sS -X POST "$WEBHOOK" --connect-timeout 10 --max-time 60 \
  -H 'Content-Type: application/json' \
  -w '\n%{http_code}' \
  --data-binary "$PAYLOAD")

BODY="$(printf '%s' "$RESP" | sed '$d')"
STATUS="$(printf '%s' "$RESP" | tail -n1)"

echo "Ответ Make: HTTP $STATUS — $BODY"
if [[ "$STATUS" != "200" ]]; then
  die "Make не принял запрос. Проверь, что сценарий включён."
fi

cat <<'EOF'

⚠️  HTTP 200 значит только, что Make ПРИНЯЛ запрос — пост ещё не опубликован.
    Открой Make → сценарий → History и убедись, что модуль LinkedIn зелёный.
EOF
